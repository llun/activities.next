/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  MediaEditError,
  getMediaEdit,
  revertMediaEdit,
  saveMediaEdit
} from '@/lib/client/mediaEdit'
import { NEUTRAL_RECIPE, type Recipe } from '@/lib/services/medias/edit/recipe'
import type { MediaStorageSaveFileOutput } from '@/lib/services/medias/types'

import { PhotoEditorDialog } from './PhotoEditorDialog'
import { exportRecipe } from './engine/exportImage'
import { drawGeometry } from './engine/geometryCanvas'
import { createRenderer } from './engine/glRenderer'
import { loadSource } from './engine/loadSource'

vi.mock('@/lib/client/mediaEdit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/mediaEdit')>()),
  getMediaEdit: vi.fn(),
  saveMediaEdit: vi.fn(),
  revertMediaEdit: vi.fn()
}))
vi.mock('./engine/glRenderer', () => ({ createRenderer: vi.fn() }))
vi.mock('./engine/exportImage', () => ({ exportRecipe: vi.fn() }))
vi.mock('./engine/loadSource', () => ({ loadSource: vi.fn() }))
vi.mock('./engine/geometryCanvas', () => ({ drawGeometry: vi.fn() }))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const SOURCE = { width: 4000, height: 3000 }
const saved = {
  id: '12',
  url: 'https://x.test/new.webp'
} as MediaStorageSaveFileOutput

const mockGetMediaEdit = vi.mocked(getMediaEdit)
const mockSaveMediaEdit = vi.mocked(saveMediaEdit)
const mockRevertMediaEdit = vi.mocked(revertMediaEdit)

interface StateOptions {
  statusCount?: number
  recipe?: Recipe | null
  editedAt?: string | null
  source?: { width: number; height: number }
  version?: number
}

const editState = ({
  statusCount = 0,
  recipe = null,
  editedAt = null,
  source = SOURCE,
  version = 2
}: StateOptions = {}) =>
  ({
    media: saved,
    edit: {
      version,
      recipe,
      editedAt,
      saveId: null,
      source: { ...source, mimeType: 'image/jpeg' },
      masks: []
    },
    usage: { statusCount, latestStatusAt: '2026-10-08T10:00:00.000Z' }
  }) as Awaited<ReturnType<typeof getMediaEdit>>

const editedRecipe: Recipe = {
  ...NEUTRAL_RECIPE,
  adjustments: { exposure: 0.5 }
}

const setup = async (options: StateOptions = {}) => {
  mockGetMediaEdit.mockResolvedValue(editState(options))
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<PhotoEditorDialog mediaId="12" onClose={onClose} onSaved={onSaved} />)
  await screen.findByRole('slider', { name: 'Exposure' })
  return { onClose, onSaved }
}

const exposure = () => screen.getByRole('slider', { name: 'Exposure' })
const saveButton = () => screen.getByRole('button', { name: 'Save' })

const nudgeExposure = () => fireEvent.keyDown(exposure(), { key: 'ArrowRight' })

// A grey ramp so Auto has something to measure.
const rampContext = {
  getImageData: (_x: number, _y: number, w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i += 1) {
      const v = 5 + Math.round((60 * i) / (w * h))
      data.set([v, v, v, 255], i * 4)
    }
    return { data, width: w, height: h }
  }
}

describe('PhotoEditorDialog', () => {
  const renderer = {
    maxTextureSize: 4096,
    isContextLost: () => false,
    setPreviewFrame: vi.fn(),
    renderPreview: vi.fn(),
    readPreview: vi.fn(() => null),
    renderToPixels: vi.fn(),
    dispose: vi.fn()
  }

  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  })
  afterAll(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createRenderer).mockReturnValue(renderer)
    vi.mocked(loadSource).mockResolvedValue({
      ...SOURCE,
      close: vi.fn()
    } as unknown as ImageBitmap)
    vi.mocked(drawGeometry).mockReturnValue({
      getContext: () => rampContext
    } as unknown as ReturnType<typeof drawGeometry>)
    vi.mocked(exportRecipe).mockResolvedValue(
      new Blob(['jpeg'], { type: 'image/jpeg' })
    )
    mockSaveMediaEdit.mockResolvedValue({
      ...editState(),
      posts: { updated: [], skipped: [] }
    })
    mockRevertMediaEdit.mockResolvedValue({
      ...editState(),
      posts: { updated: [], skipped: [] }
    })
  })

  it('loads the media and the original, then shows the editor', async () => {
    await setup()
    expect(mockGetMediaEdit).toHaveBeenCalledWith('12')
    expect(loadSource).toHaveBeenCalledWith(
      '/api/v1/media/12/edit/source',
      expect.anything()
    )
    expect(screen.getByText('Edit photo')).toBeInTheDocument()
    expect(createRenderer).toHaveBeenCalled()
    expect(renderer.setPreviewFrame).toHaveBeenCalled()
    expect(saveButton()).toBeDisabled()
    // Phase 1 has Adjust and Crop only.
    expect(screen.getByRole('tab', { name: 'Adjust' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Crop' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Masks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'AI' })).not.toBeInTheDocument()
  })

  it('starts from the saved recipe', async () => {
    await setup({ recipe: editedRecipe, editedAt: '2026-10-09T10:00:00.000Z' })
    expect(exposure()).toHaveAttribute('aria-valuetext', '+0.50 EV')
    expect(saveButton()).toBeDisabled()
  })

  it('shows a load failure', async () => {
    mockGetMediaEdit.mockRejectedValue(new Error('network'))
    render(
      <PhotoEditorDialog mediaId="12" onClose={vi.fn()} onSaved={vi.fn()} />
    )
    expect(
      await screen.findByText("Couldn't load the photo.")
    ).toBeInTheDocument()
  })

  it('refuses a photo that is too large to edit in the browser', async () => {
    mockGetMediaEdit.mockResolvedValue(
      editState({ source: { width: 10000, height: 6000 } })
    )
    render(
      <PhotoEditorDialog mediaId="12" onClose={vi.fn()} onSaved={vi.fn()} />
    )
    expect(
      await screen.findByText('This photo is too large to edit in the browser.')
    ).toBeInTheDocument()
    expect(loadSource).not.toHaveBeenCalled()
    expect(createRenderer).not.toHaveBeenCalled()
  })

  it('offers Retry when the renderer loses its context', async () => {
    await setup()
    const options = vi.mocked(createRenderer).mock.calls[0][1]
    act(() => options?.onContextLost?.())
    expect(
      await screen.findByText("Couldn't render the photo. Try again.")
    ).toBeInTheDocument()
    vi.mocked(createRenderer).mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(createRenderer).toHaveBeenCalled())
  })

  describe('changes and history', () => {
    it('a slider change enables Save and shows the value', async () => {
      await setup()
      nudgeExposure()
      expect(exposure()).toHaveAttribute('aria-valuetext', '+0.01 EV')
      expect(saveButton()).toBeEnabled()
      expect(renderer.renderPreview).toHaveBeenCalled()
    })

    it('undo and redo with the keyboard', async () => {
      await setup()
      nudgeExposure()
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
      expect(exposure()).toHaveAttribute('aria-valuetext', '0.00 EV')
      expect(saveButton()).toBeDisabled()
      fireEvent.keyDown(document.body, {
        key: 'z',
        ctrlKey: true,
        shiftKey: true
      })
      expect(exposure()).toHaveAttribute('aria-valuetext', '+0.01 EV')
      fireEvent.keyDown(document.body, { key: 'z', metaKey: true })
      fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
      expect(exposure()).toHaveAttribute('aria-valuetext', '+0.01 EV')
    })

    it('undo and redo with the buttons', async () => {
      await setup()
      expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
      nudgeExposure()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
      expect(exposure()).toHaveAttribute('aria-valuetext', '+0.01 EV')
    })

    it('ignores the shortcuts while typing in a text field', async () => {
      await setup()
      nudgeExposure()
      const input = document.createElement('input')
      document.body.appendChild(input)
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
      input.remove()
      expect(exposure()).toHaveAttribute('aria-valuetext', '+0.01 EV')
    })

    it('resets a slider with Delete', async () => {
      await setup({ recipe: editedRecipe })
      fireEvent.keyDown(exposure(), { key: 'Delete' })
      expect(exposure()).toHaveAttribute('aria-valuetext', '0.00 EV')
      expect(saveButton()).toBeEnabled()
    })

    it('holding the compare button shows the original and announces it', async () => {
      await setup()
      const compare = screen.getByRole('button', {
        name: 'Compare with original'
      })
      fireEvent.pointerDown(compare)
      expect(compare).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('status')).toHaveTextContent('Showing original')
      fireEvent.pointerUp(compare)
      expect(compare).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('status')).toHaveTextContent('Showing edit')
    })

    it('holding backslash compares', async () => {
      await setup()
      fireEvent.keyDown(window, { key: '\\' })
      expect(screen.getByRole('status')).toHaveTextContent('Showing original')
      fireEvent.keyUp(window, { key: '\\' })
      expect(screen.getByRole('status')).toHaveTextContent('Showing edit')
    })

    it('Auto sets light and colour in one undo step and reports the count', async () => {
      await setup()
      fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
      expect(screen.getByText(/^\d+ changes?$/)).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(/^Auto applied \d+/)
      expect(saveButton()).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(saveButton()).toBeDisabled()
      expect(screen.queryByText(/^\d+ changes?$/)).not.toBeInTheDocument()
    })

    it('Reset clears a section in one step', async () => {
      await setup({
        recipe: {
          ...NEUTRAL_RECIPE,
          adjustments: { exposure: 1, contrast: 20 }
        }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Reset Light' }))
      expect(exposure()).toHaveAttribute('aria-valuetext', '0.00 EV')
      expect(screen.queryByRole('button', { name: 'Reset Light' })).toBeNull()
    })
  })

  describe('crop tab', () => {
    const openCrop = () =>
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Crop' }), {
        button: 0,
        ctrlKey: false
      })

    it('shows the crop controls, the overlay and the output size', async () => {
      await setup()
      openCrop()
      expect(await screen.findByText('Straighten')).toBeInTheDocument()
      expect(
        screen.getByRole('group', { name: 'Crop area' })
      ).toBeInTheDocument()
      expect(
        screen.getByText(/4,000 × 3,000 px from 4,000 × 3,000/)
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reset crop' })).toBeNull()
    })

    it('rotates counterclockwise and can reset', async () => {
      await setup()
      openCrop()
      fireEvent.click(await screen.findByRole('button', { name: 'Rotate 90°' }))
      expect(
        screen.getByText(/3,000 × 4,000 px from 4,000 × 3,000/)
      ).toBeInTheDocument()
      expect(saveButton()).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'Reset crop' }))
      expect(
        screen.getByText(/4,000 × 3,000 px from 4,000 × 3,000/)
      ).toBeInTheDocument()
    })

    it('picks an aspect ratio and turns it on a second choice', async () => {
      await setup()
      openCrop()
      fireEvent.click(await screen.findByRole('radio', { name: '1:1' }))
      expect(
        screen.getByText(/3,000 × 3,000 px from 4,000 × 3,000/)
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('radio', { name: '4:5' }))
      expect(
        screen.getByText(/2,400 × 3,000 px from 4,000 × 3,000/)
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('radio', { name: '4:5' }))
      // Portrait to landscape: the largest 5:4 crop.
      expect(
        screen.getByText(/3,750 × 3,000 px from 4,000 × 3,000/)
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Portrait' })
      ).toBeInTheDocument()
    })

    it('moves the crop with the arrow keys', async () => {
      await setup()
      openCrop()
      fireEvent.click(await screen.findByRole('radio', { name: '1:1' }))
      const area = screen.getByRole('group', { name: 'Crop area' })
      fireEvent.keyDown(area, { key: 'ArrowRight', shiftKey: true })
      expect(saveButton()).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    })

    it('straightens with the slider', async () => {
      await setup()
      openCrop()
      const slider = await screen.findByRole('slider', { name: 'Straighten' })
      fireEvent.keyDown(slider, { key: 'ArrowRight' })
      expect(slider).toHaveAttribute('aria-valuetext', '+0.1 degrees')
    })
  })

  describe('leaving', () => {
    it('closes at once when nothing changed', async () => {
      const { onClose } = await setup()
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Edit photo' }), {
        key: 'Escape'
      })
      expect(onClose).toHaveBeenCalled()
    })

    it('asks before discarding edits, on Escape and on Cancel', async () => {
      const { onClose } = await setup()
      nudgeExposure()
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Edit photo' }), {
        key: 'Escape'
      })
      expect(await screen.findByText('Discard your edits?')).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
      await waitFor(() =>
        expect(screen.queryByText('Discard your edits?')).toBeNull()
      )

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('saving', () => {
    it('saves a photo that is in no post without asking', async () => {
      const { onSaved } = await setup()
      nudgeExposure()
      fireEvent.click(saveButton())

      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      expect(exportRecipe).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ adjustments: { exposure: 0.01 } })
      )
      const params = mockSaveMediaEdit.mock.calls[0][1]
      expect(mockSaveMediaEdit.mock.calls[0][0]).toBe('12')
      expect(params).toMatchObject({
        baseVersion: 2,
        applyToPosts: undefined,
        recipe: { v: 1, adjustments: { exposure: 0.01 } }
      })
      expect(params.saveId).toMatch(/^[0-9a-f-]{36}$/)
      expect(onSaved).toHaveBeenCalledWith(saved, { updated: [], skipped: [] })
    })

    it('saves with Ctrl+S', async () => {
      const { onSaved } = await setup()
      nudgeExposure()
      fireEvent.keyDown(document.body, { key: 's', ctrlKey: true })
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
    })

    it('asks about the posts, with Update selected, and passes the choice', async () => {
      const { onSaved } = await setup({ statusCount: 2 })
      nudgeExposure()
      fireEvent.click(saveButton())

      expect(
        await screen.findByText('Update the posts too?')
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'This photo is in 2 posts. Your original stays on your account, and you can revert later.'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByRole('radio', { name: 'Update the posts' })
      ).toBeChecked()
      expect(
        screen.getByText("Followers' servers get an edit with the new photo.")
      ).toBeInTheDocument()
      expect(
        screen.getByRole('radio', { name: 'Gallery only' })
      ).not.toBeChecked()
      expect(mockSaveMediaEdit).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('radio', { name: 'Gallery only' }))
      const buttons = screen.getAllByRole('button', { name: 'Save' })
      fireEvent.click(buttons[buttons.length - 1])
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      expect(mockSaveMediaEdit.mock.calls[0][1].applyToPosts).toBe('gallery')
    })

    it('words the prompt for one post with its date', async () => {
      await setup({ statusCount: 1 })
      nudgeExposure()
      fireEvent.click(saveButton())
      expect(
        await screen.findByText('Update the post too?')
      ).toBeInTheDocument()
      expect(
        screen.getByText(/This photo is in 1 post from 8 Oct\./)
      ).toBeInTheDocument()
      expect(
        screen.getByRole('radio', { name: 'Update the post' })
      ).toBeChecked()
    })

    it('Keep editing leaves the editor as it was', async () => {
      await setup({ statusCount: 1 })
      nudgeExposure()
      fireEvent.click(saveButton())
      fireEvent.click(
        await screen.findByRole('button', { name: 'Keep editing' })
      )
      await waitFor(() =>
        expect(screen.queryByText('Update the post too?')).toBeNull()
      )
      expect(mockSaveMediaEdit).not.toHaveBeenCalled()
      expect(saveButton()).toBeEnabled()
    })

    it('shows Saving… and locks the controls while the request runs', async () => {
      let finish: (
        value: Awaited<ReturnType<typeof saveMediaEdit>>
      ) => void = () => {}
      mockSaveMediaEdit.mockImplementation(
        () => new Promise((resolve) => (finish = resolve))
      )
      const { onSaved } = await setup()
      nudgeExposure()
      fireEvent.click(saveButton())

      expect(await screen.findByText('Saving…')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
      expect(exposure()).toHaveAttribute('data-disabled')
      await act(async () =>
        finish({ ...editState(), posts: { updated: [], skipped: [] } })
      )
      expect(onSaved).toHaveBeenCalled()
    })

    it('retries once on a network error with the same save id', async () => {
      mockSaveMediaEdit.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      const { onSaved } = await setup()
      nudgeExposure()
      fireEvent.click(saveButton())

      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      expect(mockSaveMediaEdit).toHaveBeenCalledTimes(2)
      expect(mockSaveMediaEdit.mock.calls[1][1].saveId).toBe(
        mockSaveMediaEdit.mock.calls[0][1].saveId
      )
      // The render is reused, not redone.
      expect(exportRecipe).toHaveBeenCalledTimes(1)
    })

    it('treats a stale answer carrying our save id as success and reloads the media', async () => {
      mockSaveMediaEdit.mockImplementation(async (_id, params) => {
        throw new MediaEditError(409, 'stale', {
          version: 3,
          saveId: params.saveId
        })
      })
      const { onSaved } = await setup()
      nudgeExposure()
      fireEvent.click(saveButton())

      await waitFor(() =>
        expect(onSaved).toHaveBeenCalledWith(saved, expect.anything())
      )
      expect(mockGetMediaEdit).toHaveBeenCalledTimes(2)
    })

    it.each([
      [
        'another stale answer',
        new MediaEditError(409, 'stale', {
          version: 9,
          saveId: 'someone-else'
        }),
        'This photo changed somewhere else.'
      ],
      [
        'a full quota',
        new MediaEditError(413, 'Not enough storage left for the edited photo'),
        'Not enough storage left for the edited photo.'
      ],
      [
        'the rate limit',
        new MediaEditError(429, 'Too many edits. Try again later.'),
        'Too many edits. Try again later.'
      ],
      [
        'anything else',
        new MediaEditError(500, 'boom'),
        "Couldn't save the photo."
      ]
    ])('shows an alert for %s', async (_name, error, message) => {
      mockSaveMediaEdit.mockRejectedValue(error)
      const { onSaved } = await setup()
      nudgeExposure()
      fireEvent.click(saveButton())

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(onSaved).not.toHaveBeenCalled()
      // The editor stays usable.
      expect(saveButton()).toBeEnabled()
    })

    it('Reload after a conflict asks first and reloads the saved state', async () => {
      mockSaveMediaEdit.mockRejectedValue(
        new MediaEditError(409, 'stale', { version: 9, saveId: 'other' })
      )
      await setup()
      nudgeExposure()
      fireEvent.click(saveButton())
      fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

      await waitFor(() => expect(mockGetMediaEdit).toHaveBeenCalledTimes(2))
      await screen.findByRole('slider', { name: 'Exposure' })
      expect(exposure()).toHaveAttribute('aria-valuetext', '0.00 EV')
    })

    it('returning an edited photo to neutral saves as a revert', async () => {
      const { onSaved } = await setup({
        recipe: editedRecipe,
        editedAt: '2026-10-09T10:00:00.000Z',
        statusCount: 1
      })
      fireEvent.keyDown(exposure(), { key: 'Delete' })
      fireEvent.click(saveButton())
      expect(
        await screen.findByText('Update the post too?')
      ).toBeInTheDocument()
      const buttons = screen.getAllByRole('button', { name: 'Save' })
      fireEvent.click(buttons[buttons.length - 1])

      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      expect(mockSaveMediaEdit).not.toHaveBeenCalled()
      expect(exportRecipe).not.toHaveBeenCalled()
      expect(mockRevertMediaEdit).toHaveBeenCalledWith(
        '12',
        expect.objectContaining({ baseVersion: 2, applyToPosts: 'update' })
      )
    })

    it('does not save a neutral recipe on an unedited photo', async () => {
      await setup()
      nudgeExposure()
      fireEvent.keyDown(exposure(), { key: 'Delete' })
      expect(saveButton()).toBeDisabled()
    })
  })
})
