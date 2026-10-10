/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  MediaEditError,
  getMediaEdit,
  revertMediaEdit
} from '@/lib/client/mediaEdit'
import type { MediaStorageSaveFileOutput } from '@/lib/services/medias/types'

import { PhotoEditPreview, isEditableItem } from './PhotoEditPreview'
import { isWebGl2Supported } from './engine/webglSupport'

vi.mock('@/lib/client/mediaEdit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/mediaEdit')>()),
  getMediaEdit: vi.fn(),
  revertMediaEdit: vi.fn()
}))
vi.mock('./engine/webglSupport', () => ({ isWebGl2Supported: vi.fn() }))
// The editor itself is covered by PhotoEditorDialog.test.tsx.
vi.mock('./PhotoEditorDialog', () => ({
  default: ({
    mediaId,
    onClose,
    onSaved
  }: {
    mediaId: string
    onClose: () => void
    onSaved: (
      media: unknown,
      posts: { updated: string[]; skipped: string[] }
    ) => void
  }) => (
    <div role="dialog" aria-label={`Editor for ${mediaId}`}>
      <button
        type="button"
        onClick={() =>
          onSaved({ id: mediaId }, { updated: ['a'], skipped: ['b', 'c'] })
        }
      >
        Finish
      </button>
      <button type="button" onClick={onClose}>
        Close editor
      </button>
    </div>
  )
}))

const mockGetMediaEdit = vi.mocked(getMediaEdit)
const mockRevertMediaEdit = vi.mocked(revertMediaEdit)

const media = {
  id: '12',
  url: 'https://x.test/12.webp'
} as MediaStorageSaveFileOutput

const editState = (statusCount = 0) =>
  ({
    media,
    edit: {
      version: 3,
      recipe: null,
      editedAt: null,
      saveId: null,
      source: { width: 10, height: 10, mimeType: 'image/jpeg' },
      masks: []
    },
    usage: { statusCount, latestStatusAt: '2026-10-08T10:00:00.000Z' },
    capabilities: {
      subjectModel: null,
      enhance: { available: false, model: null }
    }
  }) as Awaited<ReturnType<typeof getMediaEdit>>

const item = (overrides: Record<string, unknown> = {}) => ({
  id: '12',
  mediaType: 'image/jpeg',
  details: null,
  ...overrides
})

const editedDetails = (editedAt: string) => ({ edit: { version: 2, editedAt } })

const renderPreview = (
  props: Partial<React.ComponentProps<typeof PhotoEditPreview>> = {}
) => {
  const onEdited = vi.fn()
  const view = render(
    <PhotoEditPreview item={item()} onEdited={onEdited} {...props}>
      <img src="x.jpg" alt="Preview" />
    </PhotoEditPreview>
  )
  return { ...view, onEdited }
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('PhotoEditPreview', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    vi.mocked(isWebGl2Supported).mockReturnValue(true)
    mockGetMediaEdit.mockReset()
    mockRevertMediaEdit.mockReset()
  })

  it.each([
    ['image/jpeg', true],
    ['image/png', true],
    ['image/webp', true],
    ['image/gif', false],
    ['image/heic', false],
    ['video/mp4', false]
  ])('offers editing for %s: %s', (mediaType, editable) => {
    expect(isEditableItem({ mediaType })).toBe(editable)
    renderPreview({ item: item({ mediaType }) })
    expect(screen.getByAltText('Preview')).toBeInTheDocument()
    expect(!!screen.queryByRole('button', { name: 'Edit photo' })).toBe(
      editable
    )
  })

  it('shows the pill on a still image and opens the editor', async () => {
    renderPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Edit photo' }))
    expect(
      await screen.findByRole('dialog', { name: 'Editor for 12' })
    ).toBeInTheDocument()
  })

  it('has no pill on a video', () => {
    renderPreview({ item: item({ mediaType: 'video/mp4' }) })
    expect(
      screen.queryByRole('button', { name: 'Edit photo' })
    ).not.toBeInTheDocument()
  })

  it('disables the pill and explains why without WebGL 2', async () => {
    vi.mocked(isWebGl2Supported).mockReturnValue(false)
    renderPreview()
    const pill = screen.getByRole('button', { name: 'Edit photo' })
    expect(pill).toBeDisabled()
    fireEvent.focus(pill.parentElement as HTMLElement)
    expect(
      (await screen.findAllByText('Photo editing needs WebGL 2')).length
    ).toBeGreaterThan(0)
  })

  describe('Edited line', () => {
    const editedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString()

    it('is absent for an unedited photo', () => {
      renderPreview()
      expect(screen.queryByText(/Edited/)).not.toBeInTheDocument()
    })

    it('shows how long ago and a Revert link, with a short label on a phone', () => {
      renderPreview({ item: item({ details: editedDetails(editedAt) }) })
      expect(screen.getByText(/^Edited/)).toHaveTextContent(
        'Edited 2 minutes ago'
      )
      const revert = screen.getByRole('button', { name: 'Revert to original' })
      // Below sm only "Revert" shows; from sm the full text.
      expect(revert.querySelector('.sm\\:hidden')).toHaveTextContent(/^Revert$/)
      expect(revert.querySelector('.hidden')).toHaveTextContent(
        'Revert to original'
      )
    })

    it('asks before reverting, and does nothing when cancelled', async () => {
      renderPreview({ item: item({ details: editedDetails(editedAt) }) })
      fireEvent.click(
        screen.getByRole('button', { name: 'Revert to original' })
      )
      expect(await screen.findByText('Revert to original?')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Your edits are removed and the photo goes back to how you uploaded it.'
        )
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(mockRevertMediaEdit).not.toHaveBeenCalled()
    })

    it('reverts a photo that is in no post straight away', async () => {
      mockGetMediaEdit.mockResolvedValue(editState(0))
      mockRevertMediaEdit.mockResolvedValue({
        ...editState(0),
        posts: { updated: [], skipped: [] }
      })
      const { onEdited } = renderPreview({
        item: item({ details: editedDetails(editedAt) })
      })
      fireEvent.click(
        screen.getByRole('button', { name: 'Revert to original' })
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Revert' }))

      await waitFor(() => expect(onEdited).toHaveBeenCalledWith('12', media))
      expect(mockRevertMediaEdit).toHaveBeenCalledWith(
        '12',
        expect.objectContaining({ baseVersion: 3, applyToPosts: undefined })
      )
    })

    it('asks about the posts first when the photo is in posts', async () => {
      mockGetMediaEdit.mockResolvedValue(editState(2))
      mockRevertMediaEdit.mockResolvedValue({
        ...editState(2),
        posts: { updated: ['a', 'b'], skipped: [] }
      })
      const { onEdited } = renderPreview({
        item: item({ details: editedDetails(editedAt) })
      })
      fireEvent.click(
        screen.getByRole('button', { name: 'Revert to original' })
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Revert' }))

      expect(
        await screen.findByText('Update the posts too?')
      ).toBeInTheDocument()
      expect(mockRevertMediaEdit).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('radio', { name: 'Gallery only' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(onEdited).toHaveBeenCalled())
      expect(mockRevertMediaEdit).toHaveBeenCalledWith(
        '12',
        expect.objectContaining({ applyToPosts: 'gallery' })
      )
    })

    it('counts a revert whose answer was lost as done', async () => {
      mockGetMediaEdit.mockResolvedValue(editState(0))
      mockRevertMediaEdit.mockImplementation(async (_id, params) => {
        throw new MediaEditError(409, 'stale', {
          version: 4,
          saveId: params.saveId
        })
      })
      const { onEdited } = renderPreview({
        item: item({ details: editedDetails(editedAt) })
      })
      fireEvent.click(
        screen.getByRole('button', { name: 'Revert to original' })
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Revert' }))

      await waitFor(() => expect(onEdited).toHaveBeenCalledWith('12', media))
      expect(mockGetMediaEdit).toHaveBeenCalledTimes(2)
    })

    it('shows an error when the revert fails', async () => {
      mockGetMediaEdit.mockResolvedValue(editState(0))
      mockRevertMediaEdit.mockRejectedValue(
        new MediaEditError(429, 'slow down')
      )
      const { onEdited } = renderPreview({
        item: item({ details: editedDetails(editedAt) })
      })
      fireEvent.click(
        screen.getByRole('button', { name: 'Revert to original' })
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Revert' }))

      expect(
        await screen.findByText('Too many edits. Try again later.')
      ).toBeInTheDocument()
      expect(onEdited).not.toHaveBeenCalled()
    })
  })

  it('hands the saved media over, closes the editor and reports skipped posts', async () => {
    const { onEdited } = renderPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Edit photo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }))

    expect(onEdited).toHaveBeenCalledWith('12', { id: '12' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByText("Saved. 2 posts couldn't be updated.")
    ).toBeInTheDocument()
  })

  it('closes the editor without saving', async () => {
    const { onEdited } = renderPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Edit photo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close editor' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onEdited).not.toHaveBeenCalled()
  })
})
