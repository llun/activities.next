/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { NEUTRAL_RECIPE, type Recipe } from '@/lib/services/medias/edit/recipe'

import { MasksPanel } from './MasksPanel'
import { createRaster, getRasters, withRaster } from './maskRaster'
import { addBackgroundMask, addBrushMask, addSubjectMask } from './maskRecipe'
import { type SubjectModel, loadSubjectModel } from './modelCache'
import type { SamClient } from './samClient'
import { useMasks } from './useMasks'

vi.mock('./modelCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./modelCache')>()),
  loadSubjectModel: vi.fn()
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const MODEL: SubjectModel = {
  baseUrl: 'https://models.test/',
  files: {
    encoder: { path: 'enc.onnx', bytes: 8_882_165, sha256: 'a'.repeat(64) },
    decoder: { path: 'dec.onnx', bytes: 4_903_810, sha256: 'b'.repeat(64) }
  }
}

const SOURCE = { width: 4000, height: 3000 }
// One bitmap for the whole editor session, as in the editor.
const BITMAP = {
  width: 4000,
  height: 3000,
  close: vi.fn()
} as unknown as ImageBitmap

const makeClient = () => {
  const segment = vi.fn(async () => ({
    width: 16,
    height: 12,
    data: new Uint8Array(16 * 12).fill(255)
  }))
  const client: SamClient = {
    load: vi.fn(async () => undefined),
    embed: vi.fn(async () => undefined),
    segment,
    dispose: vi.fn()
  }
  return { client, segment }
}

interface HarnessProps {
  initial?: Recipe
  model?: SubjectModel | null
  client: SamClient
  focus?: { x: number; y: number } | null
  onRecipe?: (recipe: Recipe) => void
}

const Harness = ({
  initial = NEUTRAL_RECIPE,
  model = MODEL,
  client,
  focus = { x: 0, y: 0 },
  onRecipe
}: HarnessProps) => {
  const [recipe, setRecipe] = useState(initial)
  const tools = useMasks({
    recipe,
    onChange: (next) => {
      setRecipe(next)
      onRecipe?.(next)
    },
    source: SOURCE,
    bitmap: BITMAP,
    focus,
    storedGeometry: null,
    model,
    disabled: false,
    announce: vi.fn(),
    createClient: () => client
  })
  return (
    <>
      <MasksPanel
        recipe={recipe}
        tools={tools}
        disabled={false}
        onGestureStart={vi.fn()}
        onGestureEnd={vi.fn()}
      />
      <button type="button" onClick={() => void tools.tap({ x: 0.3, y: 0.4 })}>
        test tap
      </button>
      <output data-testid="recipe">{JSON.stringify(recipe.masks)}</output>
      <output data-testid="rasters">
        {Object.keys(getRasters(recipe)).join(',')}
      </output>
    </>
  )
}

const masksOf = () =>
  JSON.parse(screen.getByTestId('recipe').textContent ?? '[]')

const withFourMasks = () => {
  let recipe = NEUTRAL_RECIPE
  recipe = addSubjectMask(recipe, 'aaaaaaaa', { x: 0.5, y: 0.5, label: 1 })
  recipe = withRaster(
    recipe,
    'aaaaaaaa',
    createRaster({ width: 8, height: 6 }, 255)
  )
  recipe = addBackgroundMask(recipe, 'bbbbbbbb', 'aaaaaaaa')
  recipe = addBrushMask(recipe, 'cccccccc')
  recipe = withRaster(recipe, 'cccccccc', createRaster({ width: 8, height: 6 }))
  recipe = addBrushMask(recipe, 'dddddddd')
  return withRaster(recipe, 'dddddddd', createRaster({ width: 8, height: 6 }))
}

describe('MasksPanel', () => {
  beforeAll(() => {
    // The thumbnails draw on a canvas jsdom does not implement.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        async (
          _bitmap: unknown,
          options?: { resizeWidth?: number; resizeHeight?: number }
        ) => ({
          width: options?.resizeWidth ?? 1,
          height: options?.resizeHeight ?? 1,
          close: vi.fn()
        })
      )
    )
  })
  afterAll(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  beforeEach(() => {
    vi.mocked(loadSubjectModel).mockReset()
    vi.mocked(loadSubjectModel).mockResolvedValue({
      encoder: new ArrayBuffer(8),
      decoder: new ArrayBuffer(8)
    })
  })

  it('starts empty and offers the three ways to make a mask', () => {
    const { client } = makeClient()
    render(<Harness client={client} />)
    expect(
      screen.getByText(
        'No masks yet. Select the subject, or paint a brush mask.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select subject' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Background' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Brush' })).toBeEnabled()
    expect(
      screen.getByText('Select a subject first, then add its background.')
    ).toBeInTheDocument()
  })

  it('selects the subject from the photo focus and lists it', async () => {
    const { client, segment } = makeClient()
    render(<Harness client={client} focus={{ x: 0.5, y: 0.5 }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))

    await screen.findByRole('radio', { name: /Subject/ })
    expect(loadSubjectModel).toHaveBeenCalledWith(MODEL, expect.anything())
    expect(client.load).toHaveBeenCalledTimes(1)
    expect(client.embed).toHaveBeenCalledTimes(1)
    // focus (0.5, 0.5) is the point (0.75, 0.25), a positive one.
    expect(segment).toHaveBeenCalledWith([{ x: 0.75, y: 0.25, label: 1 }])
    const [subject] = masksOf()
    expect(subject).toMatchObject({
      kind: 'subject',
      points: [{ x: 0.75, y: 0.25, label: 1 }]
    })
    expect(screen.getByTestId('rasters')).toHaveTextContent(subject.id)
    expect(screen.getByText('No changes')).toBeInTheDocument()
  })

  it('embeds the picture once and reuses the model for later taps', async () => {
    const { client } = makeClient()
    render(<Harness client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))
    await screen.findByRole('radio', { name: /Subject/ })

    fireEvent.click(screen.getByText('test tap'))
    await waitFor(() => expect(masksOf()[0].points).toHaveLength(2))

    expect(client.load).toHaveBeenCalledTimes(1)
    expect(client.embed).toHaveBeenCalledTimes(1)
    expect(loadSubjectModel).toHaveBeenCalledTimes(1)
  })

  it('adds a point with Add and a negative point with Remove, then re-segments', async () => {
    const { client, segment } = makeClient()
    render(<Harness client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))
    await screen.findByRole('radio', { name: /Subject/ })

    expect(screen.getByRole('radio', { name: 'Add' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    fireEvent.click(screen.getByText('test tap'))
    await waitFor(() => expect(masksOf()[0].points).toHaveLength(2))
    expect(segment).toHaveBeenLastCalledWith([
      { x: 0.5, y: 0.5, label: 1 },
      { x: 0.3, y: 0.4, label: 1 }
    ])

    fireEvent.click(screen.getByRole('radio', { name: 'Remove' }))
    expect(screen.getByRole('radio', { name: 'Remove' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    fireEvent.click(screen.getByText('test tap'))
    await waitFor(() => expect(masksOf()[0].points).toHaveLength(3))
    expect(masksOf()[0].points[2]).toEqual({ x: 0.3, y: 0.4, label: 0 })
    expect(segment).toHaveBeenLastCalledWith([
      { x: 0.5, y: 0.5, label: 1 },
      { x: 0.3, y: 0.4, label: 1 },
      { x: 0.3, y: 0.4, label: 0 }
    ])
  })

  it('hides Select subject when the server offers no model, and the brush still works', () => {
    const { client } = makeClient()
    render(<Harness client={client} model={null} />)
    expect(
      screen.queryByRole('button', { name: 'Select subject' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Select a subject first/)).not.toBeInTheDocument()
    // No subject can be made, so a background has nothing to follow.
    expect(
      screen.queryByRole('button', { name: 'Background' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('No masks yet. Paint a brush mask.')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Brush' }))

    expect(masksOf()[0]).toMatchObject({ kind: 'brush', points: [] })
    expect(screen.getByTestId('rasters')).toHaveTextContent(masksOf()[0].id)
    expect(screen.getByRole('radio', { name: 'Brush' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    // A brush mask is refined with the brush only.
    expect(screen.getByRole('radio', { name: 'Add' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Remove' })).toBeDisabled()
    expect(
      screen.getByRole('slider', { name: 'Brush size' })
    ).toBeInTheDocument()
    expect(loadSubjectModel).not.toHaveBeenCalled()
  })

  it('refines a stored subject with the brush when the model is off, and says why', () => {
    const { client } = makeClient()
    let stored = addSubjectMask(NEUTRAL_RECIPE, 'aaaaaaaa', {
      x: 0.5,
      y: 0.5,
      label: 1
    })
    stored = withRaster(
      stored,
      'aaaaaaaa',
      createRaster({ width: 8, height: 6 }, 255)
    )
    const onRecipe = vi.fn()
    render(
      <Harness
        client={client}
        model={null}
        initial={stored}
        onRecipe={onRecipe}
      />
    )

    // Brush is the mode in use, not a disabled Add that looks chosen.
    expect(screen.getByRole('radio', { name: 'Brush' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'Add' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByRole('radio', { name: 'Add' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Remove' })).toBeDisabled()
    expect(screen.getByText(/turned off on this server/)).toBeVisible()
    expect(
      screen.getByRole('slider', { name: 'Brush size' })
    ).toBeInTheDocument()

    // A tap does not touch the mask or start a download.
    fireEvent.click(screen.getByText('test tap'))
    expect(onRecipe).not.toHaveBeenCalled()
    expect(loadSubjectModel).not.toHaveBeenCalled()
  })

  it('creates a background that follows the subject', async () => {
    const { client } = makeClient()
    render(<Harness client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))
    await screen.findByRole('radio', { name: /Subject/ })
    expect(screen.getByRole('button', { name: 'Background' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Background' }))

    const masks = masksOf()
    expect(masks).toHaveLength(2)
    expect(masks[1]).toMatchObject({
      kind: 'background',
      of: masks[0].id,
      points: []
    })
    expect(
      screen.getByText('Inverse of Subject · No changes')
    ).toBeInTheDocument()
    // One background per subject.
    expect(screen.getByRole('button', { name: 'Background' })).toBeDisabled()
    // And it has no pixels of its own to refine.
    expect(
      screen.getByText(
        'The background follows the subject. Select the subject to refine it.'
      )
    ).toBeInTheDocument()
    expect(screen.getByTestId('rasters')).toHaveTextContent(masks[0].id)
    expect(screen.getByTestId('rasters')).not.toHaveTextContent(masks[1].id)
  })

  it('stops at four masks', () => {
    const { client } = makeClient()
    render(<Harness client={client} initial={withFourMasks()} />)

    expect(
      screen.getAllByRole('radio', { name: /Subject|Background|Brush \d/ })
    ).toHaveLength(4)
    expect(screen.getByText('You can use up to 4 masks.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Select subject' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Background' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Brush' })).toBeDisabled()
  })

  it('does not call the model for a fifth mask', async () => {
    const { client } = makeClient()
    render(<Harness client={client} initial={withFourMasks()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))
    await act(async () => undefined)
    expect(loadSubjectModel).not.toHaveBeenCalled()
    expect(masksOf()).toHaveLength(4)
  })

  it('removes a mask, and a subject takes its background along', async () => {
    const { client } = makeClient()
    render(<Harness client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))
    await screen.findByRole('radio', { name: /Subject/ })
    fireEvent.click(screen.getByRole('button', { name: 'Background' }))
    expect(masksOf()).toHaveLength(2)

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove mask: Subject' })
    )

    expect(masksOf()).toHaveLength(0)
    expect(screen.getByTestId('rasters')).toHaveTextContent('')
    expect(
      screen.getByText(
        'No masks yet. Select the subject, or paint a brush mask.'
      )
    ).toBeInTheDocument()
  })

  it('changes feather with the slider and counts per-mask changes', async () => {
    const { client } = makeClient()
    render(<Harness client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))
    await screen.findByRole('radio', { name: /Subject/ })
    const feather = screen.getByRole('slider', { name: 'Feather' })
    expect(masksOf()[0].feather).toBe(8)

    fireEvent.keyDown(feather, { key: 'ArrowRight' })
    expect(masksOf()[0].feather).toBe(9)
    fireEvent.keyDown(feather, { key: 'ArrowLeft' })
    fireEvent.keyDown(feather, { key: 'ArrowLeft' })
    expect(masksOf()[0].feather).toBe(7)
    fireEvent.keyDown(feather, { key: 'Home' })
    expect(masksOf()[0].feather).toBe(0)

    const exposure = screen.getByRole('slider', { name: 'Exposure' })
    fireEvent.keyDown(exposure, { key: 'ArrowRight' })
    expect(masksOf()[0].adjustments).toEqual({ exposure: 0.01 })
    expect(screen.getByText('1 change')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reset Subject adjustments' })
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset Subject adjustments' })
    )
    expect(masksOf()[0].adjustments).toEqual({})
  })

  it('has no vignette slider on a mask', async () => {
    const { client } = makeClient()
    render(<Harness client={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))
    await screen.findByRole('radio', { name: /Subject/ })
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByRole('slider', { name: 'Texture' })).toBeInTheDocument()
    expect(
      screen.queryByRole('slider', { name: 'Vignette' })
    ).not.toBeInTheDocument()
  })

  it('shows the model download with a progress bar', async () => {
    const { client } = makeClient()
    let finish: (value: {
      encoder: ArrayBuffer
      decoder: ArrayBuffer
    }) => void = () => undefined
    vi.mocked(loadSubjectModel).mockImplementation(
      (_model, options) =>
        new Promise((resolve) => {
          options?.onProgress?.({
            loadedBytes: 6_892_988,
            totalBytes: 13_785_975,
            cached: false
          })
          finish = resolve
        })
    )
    render(<Harness client={client} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))

    expect(
      await screen.findByText('Downloading the subject model (14 MB, once)')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Subject model download' })
    ).toHaveAttribute('aria-valuetext', '50%')
    expect(
      screen.getByRole('button', { name: 'Select subject' })
    ).toBeDisabled()

    await act(async () =>
      finish({ encoder: new ArrayBuffer(8), decoder: new ArrayBuffer(8) })
    )
    await screen.findByRole('radio', { name: /Subject/ })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says so when the model cannot be loaded, and leaves the recipe alone', async () => {
    const { client } = makeClient()
    vi.mocked(loadSubjectModel).mockRejectedValue(new Error('offline'))
    render(<Harness client={client} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))

    expect(
      await screen.findByText("Couldn't load the subject model.")
    ).toBeInTheDocument()
    expect(masksOf()).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Select subject' })).toBeEnabled()
  })

  it('says so when the model finds nothing to segment', async () => {
    const { client, segment } = makeClient()
    segment.mockRejectedValue(new Error('boom'))
    render(<Harness client={client} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select subject' }))

    expect(
      await screen.findByText("Couldn't find the subject. Try again.")
    ).toBeInTheDocument()
    expect(masksOf()).toHaveLength(0)
  })

  it('selects a mask from the list with the arrow keys', async () => {
    const { client } = makeClient()
    render(<Harness client={client} initial={withFourMasks()} />)
    const rows = screen.getAllByRole('radio', {
      name: /Subject|Background|Brush \d/
    })
    // The last mask is selected when none was chosen.
    expect(rows[3]).toHaveAttribute('aria-checked', 'true')
    rows[3].focus()

    fireEvent.keyDown(rows[3], { key: 'ArrowDown' })

    expect(rows[0]).toHaveAttribute('aria-checked', 'true')
    expect(rows[3]).toHaveAttribute('aria-checked', 'false')
  })
})
