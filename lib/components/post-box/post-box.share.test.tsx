/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'

import { deleteUnpostedMedia, uploadFitnessFile } from '@/lib/client'
import { resetConnectionForTesting } from '@/lib/client/connection'
import { stageShareFiles } from '@/lib/client/share-target/shareTargetDb'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'

import { PostBox } from './post-box'
import {
  attach,
  createNoteMock,
  profile,
  resetPostBoxMediaMocks,
  uploadAttachmentMock
} from './post-box-media.testUtils'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  deleteUnpostedMedia: vi.fn().mockResolvedValue(undefined),
  createPoll: vi.fn(),
  deleteUnpostedFitnessFile: vi.fn().mockResolvedValue(true),
  describeMedia: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGalleryGears: vi.fn(),
  getGallerySettings: vi.fn(),
  getMedia: vi.fn(),
  getMediaAlbums: vi.fn(),
  suggestMediaSubjects: vi.fn(),
  updateMediaDetails: vi.fn(),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

vi.mock('@/lib/client/share-target/shareTargetDb', () => ({
  stageShareFiles: vi.fn().mockResolvedValue('handoff-1')
}))

vi.mock('@/lib/utils/extractVideoPoster', () => ({
  extractVideoPoster: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

beforeEach(() => resetConnectionForTesting())

const renderComposer = ({
  maxMediaAttachments = 4,
  initialFiles,
  initialFitnessFile,
  isMediaUploadEnabled = true
}: {
  maxMediaAttachments?: number
  initialFiles?: File[]
  initialFitnessFile?: File
  isMediaUploadEnabled?: boolean
} = {}) => {
  const ui = (files?: File[], fitness?: File, actor = profile) => (
    <InstanceLimitsProvider maxMediaAttachments={maxMediaAttachments}>
      <PostBox
        host="activities.local"
        profile={actor}
        isMediaUploadEnabled={isMediaUploadEnabled}
        initialFiles={files}
        initialFitnessFile={fitness}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    </InstanceLimitsProvider>
  )
  const view = render(ui(initialFiles, initialFitnessFile))
  return {
    ...view,
    rerenderWith: (files?: File[], fitness?: File, actor = profile) =>
      view.rerender(ui(files, fitness, actor))
  }
}

const chooseFitnessFile = (container: HTMLElement, name = 'run.fit') =>
  fireEvent.change(
    container.querySelector(
      'input[type="file"][accept=".fit,.gpx,.tcx"]'
    ) as HTMLInputElement,
    { target: { files: [new File(['data'], name)] } }
  )

const photo = (name: string) => new File([name], name, { type: 'image/jpeg' })

describe('PostBox with a workout and media', () => {
  beforeEach(() => {
    resetPostBoxMediaMocks()
    vi.mocked(uploadFitnessFile).mockResolvedValue({ id: 'fitness-1' } as never)
  })

  afterEach(() => cleanup())

  it('keeps the workout when photos are added, and posts both', async () => {
    const { container } = renderComposer()

    chooseFitnessFile(container)
    attach('heron.png')

    await waitFor(() =>
      expect(uploadAttachmentMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'heron.png' })
      )
    )
    expect(screen.getByText('run.fit')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'Morning run' }
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    const [call] = createNoteMock.mock.calls[0]
    expect(call.fitnessFileId).toBe('fitness-1')
    expect(call.attachments).toHaveLength(1)
  })

  it('keeps the photos when a workout is added', async () => {
    const { container } = renderComposer()

    attach('heron.png')
    await screen.findByRole('button', { name: 'Add media (1/4)' })
    chooseFitnessFile(container)

    expect(screen.getByText('run.fit')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add media (1/3)' })
    ).toBeInTheDocument()
  })

  it('leaves the last slot to the route map while a workout is attached', async () => {
    const { container } = renderComposer({ maxMediaAttachments: 2 })

    chooseFitnessFile(container)
    attach('heron.png', 'egret.png', 'ibis.png')

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1))
    expect(uploadAttachmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'heron.png' })
    )
    expect(
      await screen.findByRole('button', { name: 'Add media (1/1)' })
    ).toBeDisabled()
  })

  it('drops the photos past the cap when a workout joins a full composer', async () => {
    const { container } = renderComposer({ maxMediaAttachments: 2 })

    attach('heron.png', 'egret.png')
    await screen.findByRole('button', { name: 'Add media (2/2)' })
    chooseFitnessFile(container)

    expect(
      await screen.findByText(/A workout leaves room for 1 attachment/)
    ).toBeInTheDocument()
    // Removed as the tile's Remove button does: its upload is deleted.
    await waitFor(() =>
      expect(vi.mocked(deleteUnpostedMedia)).toHaveBeenCalledWith(
        'media-egret.png'
      )
    )
    expect(
      screen.getByRole('button', { name: 'Add media (1/1)' })
    ).toBeDisabled()
    expect(screen.getByText('run.fit')).toBeInTheDocument()
  })

  it('seeds a shared workout and photos once', async () => {
    const files = [photo('summit.jpg')]
    const fitness = new File(['data'], 'ride.gpx')
    const { rerenderWith } = renderComposer({
      initialFiles: files,
      initialFitnessFile: fitness
    })

    expect(await screen.findByText('ride.gpx')).toBeInTheDocument()
    await waitFor(() =>
      expect(uploadAttachmentMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'summit.jpg' })
      )
    )

    // A new render with the same props (or fresh arrays) seeds nothing more.
    rerenderWith([photo('summit.jpg')], new File(['data'], 'ride.gpx'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)
  })

  // OfflineAppShell's background bootstrap refresh can land after the reader
  // pressed Add to post (the 8 s timeout path). It hands the same actor a new
  // profile object, which must not re-target the composer and drop the files.
  it('keeps added share files when the same actor gets a refreshed profile', async () => {
    const files = [photo('summit.jpg')]
    const fitness = new File(['data'], 'ride.gpx')
    const { rerenderWith } = renderComposer({
      initialFiles: files,
      initialFitnessFile: fitness
    })
    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('ride.gpx')).toBeInTheDocument()

    rerenderWith(files, fitness, { ...profile })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText('ride.gpx')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add media (1/3)' })
    ).toBeInTheDocument()
    expect(vi.mocked(deleteUnpostedMedia)).not.toHaveBeenCalled()
  })

  it('still re-targets the composer for a different actor', async () => {
    const files = [photo('summit.jpg')]
    const { rerenderWith } = renderComposer({ initialFiles: files })
    await screen.findByRole('button', { name: 'Add media (1/4)' })

    rerenderWith(files, undefined, {
      ...profile,
      id: 'https://activities.local/users/other'
    })

    expect(
      await screen.findByRole('button', { name: 'Add media (0/4)' })
    ).toBeInTheDocument()
  })

  it('never uploads shared media while media uploads are off', async () => {
    renderComposer({
      isMediaUploadEnabled: false,
      initialFiles: [photo('summit.jpg')],
      initialFitnessFile: new File(['data'], 'ride.fit')
    })

    expect(await screen.findByText('ride.fit')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
  })

  it('caps shared photos at one less than the limit with a shared workout', async () => {
    renderComposer({
      maxMediaAttachments: 2,
      initialFiles: [photo('a.jpg'), photo('b.jpg')],
      initialFitnessFile: new File(['data'], 'ride.fit')
    })

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByRole('button', { name: 'Add media (1/1)' })
    ).toBeDisabled()
  })

  it('hands the workout to the batch importer', async () => {
    const { container } = renderComposer()

    chooseFitnessFile(container, 'run.tcx')
    fireEvent.click(
      screen.getByRole('button', { name: 'Batch import instead →' })
    )

    await waitFor(() =>
      expect(vi.mocked(stageShareFiles)).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'run.tcx' })
      ])
    )
  })

  it('offers no batch import without a workout', () => {
    renderComposer()

    expect(
      screen.queryByRole('button', { name: 'Batch import instead →' })
    ).not.toBeInTheDocument()
  })
})
