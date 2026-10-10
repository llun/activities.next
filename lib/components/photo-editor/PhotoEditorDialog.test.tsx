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
import { loadMaskRasters } from './masks/loadMasks'
import { createMaskFrameBuilder } from './masks/maskFrame'
import { createRaster } from './masks/maskRaster'

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
vi.mock('./masks/loadMasks', () => ({ loadMaskRasters: vi.fn() }))
vi.mock('./masks/maskFrame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./masks/maskFrame')>()),
  // The real builder draws on a canvas, which jsdom does not have.
  createMaskFrameBuilder: vi.fn()
}))

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
  masks?: Array<{ id: string; url: string }>
  subjectModel?: object | null
}

const editState = ({
  statusCount = 0,
  recipe = null,
  editedAt = null,
  source = SOURCE,
  version = 2,
  masks = [],
  subjectModel = null
}: StateOptions = {}) =>
  ({
    media: saved,
    edit: {
      version,
      recipe,
      editedAt,
      saveId: null,
      source: { ...source, mimeType: 'image/jpeg' },
      masks
    },
    usage: { statusCount, latestStatusAt: '2026-10-08T10:00:00.000Z' },
    capabilities: {
      subjectModel,
      enhance: { available: false, model: null }
    }
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
    setPreviewMasks: vi.fn(),
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
    vi.mocked(loadMaskRasters).mockResolvedValue({ rasters: {}, failed: [] })
    vi.mocked(createMaskFrameBuilder).mockReturnValue({
      build: vi.fn(() => null),
      clear: vi.fn()
    })
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
      expect.anything(),
      { width: 4000, height: 3000 }
    )
    expect(screen.getByText('Edit photo')).toBeInTheDocument()
    expect(createRenderer).toHaveBeenCalled()
    expect(renderer.setPreviewFrame).toHaveBeenCalled()
    expect(saveButton()).toBeDisabled()
    // Phase 2 has Adjust, Crop and Masks (the AI tab is phase 3).
    expect(screen.getByRole('tab', { name: 'Adjust' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Crop' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Masks' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'AI' })).not.toBeInTheDocument()
  })

  // Touch browsers ring a control focused programmatically after a tap, so
  // Cancel must not take focus on open; it stays the first stop for Tab.
  it('opens with the dialog focused, not Cancel', async () => {
    await setup()
    const dialog = screen.getByRole('dialog')
    expect(document.activeElement).toBe(dialog)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).not.toHaveFocus()
    const tabbable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]'
      )
    ).filter(
      (element) => element.tabIndex >= 0 && !element.hasAttribute('disabled')
    )
    expect(tabbable[0]).toBe(cancel)
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
      // The preview renders on the next animation frame.
      await waitFor(() => expect(renderer.renderPreview).toHaveBeenCalled())
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
  describe('masks tab', () => {
    const MODEL = {
      baseUrl: 'https://models.test/',
      files: {
        encoder: { path: 'enc.onnx', bytes: 8, sha256: 'a'.repeat(64) },
        decoder: { path: 'dec.onnx', bytes: 8, sha256: 'b'.repeat(64) }
      }
    }
    const savedMasks = {
      ...NEUTRAL_RECIPE,
      masks: [
        {
          id: 'aaaaaaaa',
          kind: 'brush' as const,
          points: [],
          feather: 8,
          adjustments: { exposure: 0.5 }
        }
      ]
    } as Recipe

    const openMasks = () =>
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Masks' }), {
        button: 0,
        ctrlKey: false
      })

    beforeAll(() => {
      // The mask thumbnails draw on a canvas jsdom does not implement.
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    })

    it('offers Select subject only when the server has a model', async () => {
      await setup({ subjectModel: MODEL })
      openMasks()
      expect(
        await screen.findByRole('button', { name: 'Select subject' })
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Brush' })).toBeInTheDocument()
    })

    it('hides Select subject without a model, and the brush still works', async () => {
      await setup({ subjectModel: null })
      openMasks()
      expect(
        await screen.findByRole('button', { name: 'Brush' })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Select subject' })
      ).toBeNull()
    })

    it('a new brush mask needs an adjustment to save, undoes, and uploads its PNG', async () => {
      const { onSaved } = await setup()
      openMasks()
      fireEvent.click(await screen.findByRole('button', { name: 'Brush' }))
      // A mask that changes nothing is a neutral recipe.
      expect(saveButton()).toBeDisabled()

      const exposureSlider = screen.getByRole('slider', { name: 'Exposure' })
      fireEvent.keyDown(exposureSlider, { key: 'ArrowRight' })
      expect(saveButton()).toBeEnabled()

      // Undo takes the adjustment, then the mask itself.
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
      expect(screen.getByRole('radiogroup', { name: 'Masks' })).toBeVisible()
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
      expect(screen.queryByRole('radiogroup', { name: 'Masks' })).toBeNull()
      fireEvent.keyDown(document.body, {
        key: 'z',
        ctrlKey: true,
        shiftKey: true
      })
      fireEvent.keyDown(document.body, {
        key: 'z',
        ctrlKey: true,
        shiftKey: true
      })
      fireEvent.click(saveButton())
      await waitFor(() => expect(onSaved).toHaveBeenCalled())

      const params = mockSaveMediaEdit.mock.calls[0][1]
      expect(params.recipe.masks).toHaveLength(1)
      const [mask] = params.recipe.masks
      expect(mask).toMatchObject({
        kind: 'brush',
        adjustments: { exposure: 0.01 }
      })
      expect(Object.keys(params.masks ?? {})).toEqual([mask.id])
      expect(params.masks?.[mask.id]).toBeInstanceOf(Blob)
      expect(exportRecipe).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          masks: [expect.objectContaining({ id: mask.id })]
        })
      )
    })

    it('loads the saved masks into the renderer and does not upload them again', async () => {
      const raster = createRaster({ width: 8, height: 6 }, 255)
      vi.mocked(loadMaskRasters).mockResolvedValue({
        rasters: { aaaaaaaa: raster },
        failed: []
      })
      const { onSaved } = await setup({
        recipe: savedMasks,
        editedAt: '2026-10-09T10:00:00.000Z',
        masks: [{ id: 'aaaaaaaa', url: '/api/v1/media/12/edit/masks/aaaaaaaa' }]
      })
      expect(loadMaskRasters).toHaveBeenCalledWith(
        expect.objectContaining({ masks: [expect.anything()] }),
        [{ id: 'aaaaaaaa', url: '/api/v1/media/12/edit/masks/aaaaaaaa' }],
        expect.anything()
      )
      await waitFor(() => expect(renderer.setPreviewMasks).toHaveBeenCalled())
      expect(saveButton()).toBeDisabled()

      // Only the mask's slider moves; its pixels are the ones on the server.
      openMasks()
      fireEvent.keyDown(
        await screen.findByRole('slider', { name: 'Feather' }),
        {
          key: 'ArrowRight'
        }
      )
      fireEvent.click(saveButton())
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      const params = mockSaveMediaEdit.mock.calls[0][1]
      expect(params.recipe.masks[0].feather).toBe(9)
      expect(params.masks ?? {}).toEqual({})
    })

    it('opens without a mask whose image cannot be read, says so, and saves it away', async () => {
      vi.mocked(loadMaskRasters).mockResolvedValue({
        rasters: {},
        failed: ['aaaaaaaa']
      })
      const { onSaved } = await setup({
        recipe: {
          ...savedMasks,
          adjustments: { contrast: 20 }
        } as Recipe,
        editedAt: '2026-10-09T10:00:00.000Z',
        masks: [{ id: 'aaaaaaaa', url: '/x' }]
      })

      expect(
        screen.getByText(/A saved mask couldn't be loaded/)
      ).toBeInTheDocument()
      expect(screen.queryByText("Couldn't load the photo.")).toBeNull()
      // The mask is left out of the edit: saving it away is a change.
      expect(saveButton()).toBeEnabled()
      fireEvent.click(saveButton())
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      const params = mockSaveMediaEdit.mock.calls[0][1]
      expect(params.recipe.masks).toEqual([])
      expect(params.recipe.adjustments).toEqual({ contrast: 20 })
      expect(params.masks ?? {}).toEqual({})
    })

    it('still reverts to the original when the only saved mask cannot be read', async () => {
      vi.mocked(loadMaskRasters).mockResolvedValue({
        rasters: {},
        failed: ['aaaaaaaa']
      })
      const { onSaved } = await setup({
        recipe: savedMasks,
        editedAt: '2026-10-09T10:00:00.000Z',
        masks: [{ id: 'aaaaaaaa', url: '/x' }]
      })

      // Nothing but the lost mask was edited: the present recipe is neutral.
      fireEvent.click(saveButton())
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      expect(mockRevertMediaEdit).toHaveBeenCalledTimes(1)
      expect(mockSaveMediaEdit).not.toHaveBeenCalled()
    })

    it('closes without asking when a lost mask is the only thing that differs, and Save stays on', async () => {
      vi.mocked(loadMaskRasters).mockResolvedValue({
        rasters: {},
        failed: ['aaaaaaaa']
      })
      const { onClose } = await setup({
        recipe: savedMasks,
        editedAt: '2026-10-09T10:00:00.000Z',
        masks: [{ id: 'aaaaaaaa', url: '/x' }]
      })
      expect(screen.getByText(/is removed when you save/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Discard your edits?')).toBeNull()
    })

    it('says a lost mask with no adjustment changes nothing, and Cancel closes quietly', async () => {
      vi.mocked(loadMaskRasters).mockResolvedValue({
        rasters: {},
        failed: ['aaaaaaaa']
      })
      const { onClose } = await setup({
        recipe: {
          ...savedMasks,
          adjustments: { contrast: 20 },
          masks: [{ ...savedMasks.masks[0], adjustments: {} }]
        } as Recipe,
        editedAt: '2026-10-09T10:00:00.000Z',
        masks: [{ id: 'aaaaaaaa', url: '/x' }]
      })

      expect(screen.getByText(/It had no adjustments/)).toBeInTheDocument()
      expect(screen.queryByText(/removed when you save/)).toBeNull()
      // Dropping it is not a render change, so there is nothing to save yet.
      expect(saveButton()).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('loads the masks again from "Try again"', async () => {
      const raster = createRaster({ width: 8, height: 6 }, 255)
      vi.mocked(loadMaskRasters)
        .mockResolvedValueOnce({ rasters: {}, failed: ['aaaaaaaa'] })
        .mockResolvedValue({ rasters: { aaaaaaaa: raster }, failed: [] })
      await setup({
        recipe: savedMasks,
        editedAt: '2026-10-09T10:00:00.000Z',
        masks: [{ id: 'aaaaaaaa', url: '/x' }]
      })
      expect(
        screen.getByText(/A saved mask couldn't be loaded/)
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

      await waitFor(() =>
        expect(screen.queryByText(/A saved mask couldn't be loaded/)).toBeNull()
      )
      expect(loadMaskRasters).toHaveBeenCalledTimes(2)
      // The mask is back, so nothing is left to save.
      expect(
        await screen.findByRole('slider', { name: 'Exposure' })
      ).toBeTruthy()
      expect(saveButton()).toBeDisabled()
    })

    it('closes without asking after a mask slider goes to 0 and back', async () => {
      const raster = createRaster({ width: 8, height: 6 }, 255)
      vi.mocked(loadMaskRasters).mockResolvedValue({
        rasters: { aaaaaaaa: raster },
        failed: []
      })
      const { onClose } = await setup({
        recipe: {
          ...savedMasks,
          masks: [
            {
              ...savedMasks.masks[0],
              adjustments: { contrast: 1, saturation: 10 }
            }
          ]
        } as Recipe,
        editedAt: '2026-10-09T10:00:00.000Z',
        masks: [{ id: 'aaaaaaaa', url: '/x' }]
      })
      openMasks()
      const contrast = await screen.findByRole('slider', { name: 'Contrast' })

      fireEvent.keyDown(contrast, { key: 'ArrowLeft' })
      fireEvent.keyDown(contrast, { key: 'ArrowRight' })
      // The same values again, with the keys in another order.
      expect(saveButton()).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Discard your edits?')).toBeNull()
    })

    it('does not enable Save for a mask with no adjustment until a slider moves', async () => {
      await setup({ subjectModel: null })
      openMasks()
      fireEvent.click(await screen.findByRole('button', { name: 'Brush' }))
      expect(saveButton()).toBeDisabled()

      fireEvent.keyDown(
        await screen.findByRole('slider', { name: 'Exposure' }),
        {
          key: 'ArrowRight'
        }
      )
      expect(saveButton()).toBeEnabled()
    })

    it('still asks before discarding a mask with no adjustment', async () => {
      const { onClose } = await setup({ subjectModel: null })
      openMasks()
      fireEvent.click(await screen.findByRole('button', { name: 'Brush' }))

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onClose).not.toHaveBeenCalled()
      expect(await screen.findByText('Discard your edits?')).toBeInTheDocument()
    })
  })
})
