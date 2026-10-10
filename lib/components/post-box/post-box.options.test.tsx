/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Status, StatusType } from '@/lib/types/domain/status'

import { PostBox } from './post-box'
import {
  choosePostOption,
  createNoteMock,
  editStatus,
  openPostOptions,
  profile,
  resetEditMediaMocks
} from './post-box.testUtils'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  createPoll: vi.fn(),
  deleteAccountMedia: vi.fn().mockResolvedValue(true),
  deleteFitnessFile: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGallerySettings: vi.fn().mockResolvedValue({
    allowEmptyDescription: true,
    altTextAvailable: false
  }),
  getMedia: vi.fn().mockRejectedValue(new Error('details unavailable')),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

const parentStatus = {
  id: 'https://activities.local/users/llun/statuses/parent-1',
  url: 'https://activities.local/@llun/parent-1',
  actorId: profile.id,
  actor: profile,
  type: StatusType.enum.Note,
  text: 'a parent post',
  tags: [],
  to: [],
  cc: []
} as unknown as Status

const renderNewPost = () =>
  render(
    <PostBox
      host="activities.local"
      profile={profile}
      onDiscardReply={vi.fn()}
      onPostCreated={vi.fn()}
      onPostUpdated={vi.fn()}
      onDiscardEdit={vi.fn()}
    />
  )

const fitnessInput = (container: HTMLElement) =>
  container.querySelector(
    'input[type="file"][accept=".fit,.gpx,.tcx"]'
  ) as HTMLInputElement

describe('PostBox options menu', () => {
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    resetEditMediaMocks()
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  it('keeps photos, emoji and Post options in the toolbar and nothing else', () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /^Add media/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add emoji or sticker' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Post options' })
    ).toBeInTheDocument()

    // The old toolbar controls are gone.
    for (const name of [
      'Add poll',
      'Add content warning',
      'Toggle preview',
      'Upload fitness activity file',
      /^Set visibility/
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('offers the fitness file item on a new post', async () => {
    renderNewPost()
    await openPostOptions()

    expect(
      screen.getByRole('menuitem', { name: 'Fitness file' })
    ).toBeInTheDocument()
  })

  it('hides the fitness file item when replying', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        replyStatus={parentStatus}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )
    await openPostOptions()

    expect(
      screen.queryByRole('menuitem', { name: 'Fitness file' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Poll' })
    ).toBeInTheDocument()
  })

  it('hides the fitness file item when editing', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={editStatus}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )
    await openPostOptions()

    expect(
      screen.queryByRole('menuitem', { name: 'Fitness file' })
    ).not.toBeInTheDocument()
  })

  it('opens the fitness file picker from the menu and attaches the chosen file', async () => {
    const { container } = renderNewPost()
    const input = fitnessInput(container)
    const click = vi.spyOn(input, 'click')

    await choosePostOption('Fitness file', 'menuitem')
    expect(click).toHaveBeenCalledTimes(1)

    const file = new File(['data'], 'morning-run.gpx')
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText('morning-run.gpx')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
  })

  it('rejects an unsupported fitness file with the same message as before', async () => {
    const { container } = renderNewPost()

    await choosePostOption('Fitness file', 'menuitem')
    fireEvent.change(fitnessInput(container), {
      target: { files: [new File(['data'], 'photo.png')] }
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid file type. Please upload .fit, .gpx, .tcx files only.'
    )
  })

  it('shows the warning field and the preview from their menu toggles', async () => {
    renderNewPost()

    await choosePostOption('Content warning')
    expect(screen.getByPlaceholderText('Write your warning here')).toBeVisible()

    await choosePostOption('Preview')
    expect(screen.getByText('Nothing to preview')).toBeInTheDocument()

    await choosePostOption('Content warning')
    expect(
      screen.queryByPlaceholderText('Write your warning here')
    ).not.toBeInTheDocument()
  })

  it('turns the poll editor on from the menu', async () => {
    // The poll editor renders a Radix Switch, which measures itself; jsdom has
    // no ResizeObserver.
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    renderNewPost()

    await choosePostOption('Poll')

    expect(
      await screen.findByRole('button', { name: 'Remove poll' })
    ).toBeInTheDocument()
  })

  it('names the edit-mode cancel button "Cancel Edit" and discards the edit', () => {
    const onDiscardEdit = vi.fn()
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={editStatus}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={onDiscardEdit}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Edit' }))

    expect(onDiscardEdit).toHaveBeenCalledTimes(1)
  })

  it('posts with the visibility and quote policy chosen in the submenu', async () => {
    createNoteMock.mockResolvedValue({
      status: { id: 'new' }
    } as unknown as Awaited<ReturnType<typeof createNoteMock>>)
    renderNewPost()

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'hello' }
    })
    await openPostOptions()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Visibility/ }), {
      key: 'ArrowRight'
    })
    fireEvent.click(
      await screen.findByRole('menuitemradio', { name: /unlisted/i })
    )
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    )

    await openPostOptions()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Visibility/ }), {
      key: 'ArrowRight'
    })
    const quoteGroup = await screen.findByRole('group', {
      name: /who can quote/i
    })
    fireEvent.click(
      Array.from(quoteGroup.querySelectorAll('[role="menuitemradio"]')).find(
        (item) => item.textContent === 'No one'
      ) as HTMLElement
    )
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createNoteMock).toHaveBeenCalled())
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: 'unlisted',
        quoteApprovalPolicy: 'nobody'
      })
    )
  })
})
