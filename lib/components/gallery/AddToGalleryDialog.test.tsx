/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, waitFor } from '@testing-library/react'

import {
  addMediaToGallery,
  deleteUnpostedMedia,
  getGallerySettings,
  getMedia,
  suggestMediaSubjects,
  uploadAttachment
} from '@/lib/client'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import type { MediaDetailsDialogItem } from '@/lib/components/media-details/media-details-dialog'
import { createDeferred } from '@/lib/testing/deferred'
import type { UploadedAttachment } from '@/lib/types/domain/attachment'

import { AddToGalleryDialog } from './AddToGalleryDialog'

vi.mock('@/lib/client', () => ({
  addMediaToGallery: vi.fn(),
  deleteUnpostedMedia: vi.fn(),
  getGallerySettings: vi.fn(),
  getMedia: vi.fn(),
  suggestMediaSubjects: vi.fn(),
  uploadAttachment: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file: File) => Promise.resolve(file))
}))
vi.mock('@/lib/utils/extractVideoPoster', () => ({
  extractVideoPoster: vi.fn().mockResolvedValue(null)
}))

interface DialogProps {
  context: string
  items: MediaDetailsDialogItem[]
  initialId: string
  settings: { subjectSuggestionsAvailable?: boolean } | null
  suggestionsPending?: Record<string, true>
  onAdd: (mediaIds: string[]) => Promise<void>
  onDiscard: () => void
  onClose: () => void
  onRemoveItem: (id: string) => void
  onDetailsRefreshed: (id: string, patch: object, value: object) => void
}
const dialog = vi.hoisted(() => ({ props: null as unknown }))
const latest = () => dialog.props as DialogProps

vi.mock('@/lib/components/media-details/media-details-dialog', () => ({
  MediaDetailsDialog: (props: unknown) => {
    dialog.props = props
    return <div role="dialog" aria-label="Add to gallery" />
  }
}))

const uploadMock = vi.mocked(uploadAttachment)
const getMediaMock = vi.mocked(getMedia)
const suggestMock = vi.mocked(suggestMediaSubjects)
const settingsMock = vi.mocked(getGallerySettings)
const addMock = vi.mocked(addMediaToGallery)
const deleteMock = vi.mocked(deleteUnpostedMedia)

const uploaded = (id: string, name: string): UploadedAttachment => ({
  type: 'upload',
  id,
  mediaType: 'image/jpeg',
  url: `https://activities.local/files/${name}`,
  width: 800,
  height: 600
})

const file = (name: string, type = 'image/jpeg') =>
  new File([name], name, { type })

const entity = (id: string, takenAt: string | null = null) =>
  ({
    id,
    description: null,
    details: {
      subject: null,
      takenAt,
      camera: null,
      lens: null,
      exposure: null,
      place: null,
      inGallery: false,
      subjectSuggestions: null
    }
  }) as unknown as Awaited<ReturnType<typeof getMedia>>

const renderDialog = (
  files: File[],
  props: { onClose?: () => void; onAdded?: (ids: string[]) => void } = {},
  maxMediaFileSize?: number
) =>
  render(
    <InstanceLimitsProvider maxMediaFileSize={maxMediaFileSize}>
      <AddToGalleryDialog
        files={files}
        onClose={props.onClose ?? vi.fn()}
        onAdded={props.onAdded ?? vi.fn()}
      />
    </InstanceLimitsProvider>
  )

const states = () => latest().items.map((item) => item.upload?.state ?? 'done')

describe('AddToGalleryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dialog.props = null
    let counter = 0
    global.crypto.randomUUID = vi.fn(() => `temp-${counter++}` as never)
    global.URL.createObjectURL = vi.fn((blob) => `blob:${(blob as File).name}`)
    global.URL.revokeObjectURL = vi.fn()
    settingsMock.mockResolvedValue({
      subjectSuggestionsAvailable: false,
      subjectSuggestionMode: 'off'
    } as never)
    uploadMock.mockImplementation(async (f) => uploaded(`id-${f.name}`, f.name))
    getMediaMock.mockImplementation(async (id) => entity(id))
    deleteMock.mockResolvedValue(undefined)
    addMock.mockImplementation(async (ids) => ids)
  })

  it('opens at once in Add to gallery mode, every file uploading from a preview', async () => {
    const pending = createDeferred<UploadedAttachment>()
    uploadMock.mockReturnValue(pending.promise)
    renderDialog([file('a.jpg'), file('b.jpg')])

    await waitFor(() => expect(latest().items).toHaveLength(2))
    expect(latest().context).toBe('add')
    expect(latest().initialId).toBe('temp-0')
    expect(latest().items.map((item) => item.url)).toEqual([
      'blob:a.jpg',
      'blob:b.jpg'
    ])
    expect(states()).toEqual(['uploading', 'uploading'])
    expect(latest().items[0].details).toBeNull()
  })

  it('shows the uploaded media with the details the server read from it', async () => {
    getMediaMock.mockImplementation(async (id) =>
      entity(id, '2026-10-01T08:00:00.000Z')
    )
    renderDialog([file('a.jpg')])

    await waitFor(() => expect(states()).toEqual(['done']))
    await waitFor(() =>
      expect(latest().items[0].details?.takenAt).toBe(
        '2026-10-01T08:00:00.000Z'
      )
    )
    expect(latest().items[0]).toEqual(
      expect.objectContaining({
        id: 'id-a.jpg',
        url: 'https://activities.local/files/a.jpg',
        width: 800,
        height: 600
      })
    )
    expect(getMediaMock).toHaveBeenCalledWith('id-a.jpg')
  })

  it('uploads three files at a time, in order', async () => {
    const gates = Array.from({ length: 5 }, () =>
      createDeferred<UploadedAttachment>()
    )
    let call = 0
    uploadMock.mockImplementation(() => gates[call++].promise)
    renderDialog(['a', 'b', 'c', 'd', 'e'].map((n) => file(`${n}.jpg`)))

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(3))
    expect(states()).toEqual([
      'uploading',
      'uploading',
      'uploading',
      'uploading',
      'uploading'
    ])

    await act(async () => gates[0].resolve(uploaded('id-a', 'a.jpg')))
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(4))
    expect(uploadMock.mock.calls.map((c) => (c[0] as File).name)).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
      'd.jpg'
    ])
  })

  it('marks a file that fails, with the reason, and goes on with the rest', async () => {
    uploadMock.mockImplementation(async (f) => {
      if (f.name === 'bad.jpg') throw new Error('Quota exceeded')
      return uploaded(`id-${f.name}`, f.name)
    })
    renderDialog([file('bad.jpg'), file('good.jpg')])

    await waitFor(() => expect(states()).toEqual(['failed', 'done']))
    expect(latest().items[0].upload).toEqual({
      state: 'failed',
      error: 'Quota exceeded'
    })
  })

  it('treats a rejected upload as a failure', async () => {
    uploadMock.mockResolvedValue(null)
    renderDialog([file('a.jpg')])

    await waitFor(() => expect(states()).toEqual(['failed']))
    expect(latest().items[0].upload?.error).toBe(
      'The server rejected the upload'
    )
  })

  it('does not upload a file over the instance’s size limit', async () => {
    renderDialog([file('a.jpg')], {}, 1)

    await waitFor(() => expect(states()).toEqual(['failed']))
    expect(latest().items[0].upload?.error).toMatch(/upload limit/)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('still works when reading the details fails', async () => {
    getMediaMock.mockRejectedValue(new Error('boom'))
    renderDialog([file('a.jpg')])

    await waitFor(() => expect(states()).toEqual(['done']))
    expect(latest().items[0].details).toBeNull()
  })

  it('asks for subject suggestions two at a time when the owner’s setting allows it', async () => {
    settingsMock.mockResolvedValue({
      subjectSuggestionsAvailable: true,
      subjectSuggestionMode: 'model'
    } as never)
    const gates: Record<string, ReturnType<typeof createDeferred<unknown>>> = {}
    suggestMock.mockImplementation((id) => {
      gates[id] = createDeferred<unknown>()
      return gates[id].promise as never
    })
    renderDialog([file('a.jpg'), file('b.jpg'), file('c.jpg')])

    await waitFor(() => expect(suggestMock).toHaveBeenCalledTimes(2))
    expect(latest().suggestionsPending).toHaveProperty('id-a.jpg')

    const suggestions = { candidates: [] }
    await act(async () => gates['id-a.jpg'].resolve(suggestions))
    await waitFor(() => expect(suggestMock).toHaveBeenCalledTimes(3))
    await waitFor(() =>
      expect(latest().items[0].details?.subjectSuggestions).toEqual(suggestions)
    )
    expect(latest().suggestionsPending).not.toHaveProperty('id-a.jpg')
  })

  it('asks for no suggestions when they are off', async () => {
    renderDialog([file('a.jpg')])
    await waitFor(() => expect(states()).toEqual(['done']))
    await waitFor(() => expect(latest().items[0].details).not.toBeNull())
    expect(suggestMock).not.toHaveBeenCalled()
  })

  it('keeps what a lookup retry or a suggestion refreshed', async () => {
    renderDialog([file('a.jpg')])
    await waitFor(() => expect(latest().items[0].details).not.toBeNull())

    act(() =>
      latest().onDetailsRefreshed(
        'id-a.jpg',
        { takenAt: '2026-01-01T00:00:00.000Z' },
        {}
      )
    )

    expect(latest().items[0].details?.takenAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('confirms the photos on Add and tells the page which were added', async () => {
    const onAdded = vi.fn()
    renderDialog([file('a.jpg'), file('b.jpg')], { onAdded })
    await waitFor(() => expect(states()).toEqual(['done', 'done']))

    await act(async () => latest().onAdd(['id-b.jpg', 'id-a.jpg']))

    expect(addMock).toHaveBeenCalledWith(['id-b.jpg', 'id-a.jpg'])
    expect(onAdded).toHaveBeenCalledWith(['id-b.jpg', 'id-a.jpg'])
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('does not tell the page when the confirm fails, and lets Add be tried again', async () => {
    addMock.mockRejectedValueOnce(new Error('Not found'))
    const onAdded = vi.fn()
    renderDialog([file('a.jpg')], { onAdded })
    await waitFor(() => expect(states()).toEqual(['done']))

    await expect(latest().onAdd(['id-a.jpg'])).rejects.toThrow('Not found')
    expect(onAdded).not.toHaveBeenCalled()

    await act(async () => latest().onAdd(['id-a.jpg']))
    expect(onAdded).toHaveBeenCalledWith(['id-a.jpg'])
  })

  it('keeps the uploads when the dialog closes after an add', async () => {
    const onClose = vi.fn()
    renderDialog([file('a.jpg')], { onClose })
    await waitFor(() => expect(states()).toEqual(['done']))

    act(() => latest().onClose())

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(deleteMock).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a.jpg')
  })

  it('deletes what was uploaded when cancelled, and closes', async () => {
    const onClose = vi.fn()
    renderDialog([file('a.jpg'), file('bad.jpg')], { onClose })
    uploadMock.mockImplementation(async (f) => {
      if (f.name === 'bad.jpg') throw new Error('nope')
      return uploaded(`id-${f.name}`, f.name)
    })
    await waitFor(() => expect(states()).not.toContain('uploading'))

    act(() => latest().onDiscard())

    expect(deleteMock.mock.calls.map((call) => call[0])).toEqual(['id-a.jpg'])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('deletes a file that finishes uploading after the dialog was cancelled', async () => {
    const pending = createDeferred<UploadedAttachment>()
    uploadMock.mockReturnValue(pending.promise)
    const onClose = vi.fn()
    renderDialog([file('a.jpg')], { onClose })
    await waitFor(() => expect(uploadMock).toHaveBeenCalled())

    act(() => latest().onDiscard())
    expect(deleteMock).not.toHaveBeenCalled()
    await act(async () => pending.resolve(uploaded('late', 'a.jpg')))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('late'))
    expect(getMediaMock).not.toHaveBeenCalled()
  })

  it('drops a failed file from the batch', async () => {
    uploadMock.mockImplementation(async (f) => {
      if (f.name === 'bad.jpg') throw new Error('nope')
      return uploaded(`id-${f.name}`, f.name)
    })
    renderDialog([file('bad.jpg'), file('good.jpg')])
    await waitFor(() => expect(states()).toEqual(['failed', 'done']))

    act(() => latest().onRemoveItem('temp-0'))

    expect(latest().items.map((item) => item.id)).toEqual(['id-good.jpg'])
  })
})
