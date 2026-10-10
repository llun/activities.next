/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'

import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import { createRaster, withRaster } from './maskRaster'
import { addSubjectMask } from './maskRecipe'
import {
  type SubjectModel,
  isModelCached,
  loadSubjectModel
} from './modelCache'
import type { SamClient } from './samClient'
import { useMasks } from './useMasks'

vi.mock('./modelCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./modelCache')>()),
  loadSubjectModel: vi.fn(),
  isModelCached: vi.fn(async () => false)
}))

const MODEL: SubjectModel = {
  baseUrl: 'https://models.test/',
  files: {
    encoder: { path: 'enc.onnx', bytes: 8, sha256: 'a'.repeat(64) },
    decoder: { path: 'dec.onnx', bytes: 8, sha256: 'b'.repeat(64) }
  }
}

const BITMAP = {
  width: 400,
  height: 300,
  close: vi.fn()
} as unknown as ImageBitmap

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const makeClient = () => {
  const client: SamClient = {
    load: vi.fn(async () => undefined),
    embed: vi.fn(async () => undefined),
    segment: vi.fn(async () => ({
      width: 4,
      height: 3,
      data: new Uint8Array(12).fill(255)
    })),
    dispose: vi.fn()
  }
  return client
}

const setup = (client: SamClient, options: { model?: SubjectModel } = {}) =>
  renderHook(() =>
    useMasks({
      recipe: NEUTRAL_RECIPE,
      onChange: vi.fn(),
      source: { width: 400, height: 300 },
      bitmap: BITMAP,
      focus: { x: 0.5, y: 0.5 },
      storedGeometry: null,
      model: options.model ?? MODEL,
      disabled: false,
      announce: vi.fn(),
      createClient: () => client
    })
  )

describe('useMasks lifecycle', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))
    )
  })
  afterAll(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.mocked(loadSubjectModel).mockReset()
  })

  it('aborts the download and creates no worker when the editor closes during it', async () => {
    const download = deferred<{ encoder: ArrayBuffer; decoder: ArrayBuffer }>()
    vi.mocked(loadSubjectModel).mockReturnValue(download.promise)
    const client = makeClient()
    const createClient = vi.fn(() => client)
    const { result, unmount } = renderHook(() =>
      useMasks({
        recipe: NEUTRAL_RECIPE,
        onChange: vi.fn(),
        source: { width: 400, height: 300 },
        bitmap: BITMAP,
        focus: { x: 0.5, y: 0.5 },
        storedGeometry: null,
        model: MODEL,
        disabled: false,
        announce: vi.fn(),
        createClient
      })
    )

    let selecting!: Promise<void>
    await act(async () => {
      selecting = result.current.selectSubject()
    })
    const { signal } = vi.mocked(loadSubjectModel).mock.calls[0][1]!
    expect(signal?.aborted).toBe(false)

    unmount()
    expect(signal?.aborted).toBe(true)

    // The download still finishes (or fails): nothing runs after it.
    download.resolve({
      encoder: new ArrayBuffer(8),
      decoder: new ArrayBuffer(8)
    })
    await selecting
    expect(createClient).not.toHaveBeenCalled()
    expect(client.load).not.toHaveBeenCalled()
    expect(client.embed).not.toHaveBeenCalled()
  })

  it('terminates the worker when the editor closes while the model loads', async () => {
    const files = { encoder: new ArrayBuffer(8), decoder: new ArrayBuffer(8) }
    vi.mocked(loadSubjectModel).mockResolvedValue(files)
    const loading = deferred<void>()
    const client = makeClient()
    vi.mocked(client.load).mockReturnValue(loading.promise)
    const { result, unmount } = setup(client)

    let selecting!: Promise<void>
    await act(async () => {
      selecting = result.current.selectSubject()
    })
    expect(client.load).toHaveBeenCalledTimes(1)

    unmount()
    // The worker exists from the moment it is created, so it is ended now.
    expect(client.dispose).toHaveBeenCalledTimes(1)

    loading.resolve()
    await selecting
    expect(client.embed).not.toHaveBeenCalled()
    expect(client.segment).not.toHaveBeenCalled()
    expect(client.dispose).toHaveBeenCalled()
  })

  it('stops after the model loads when the editor closed before the photo was embedded', async () => {
    vi.mocked(loadSubjectModel).mockResolvedValue({
      encoder: new ArrayBuffer(8),
      decoder: new ArrayBuffer(8)
    })
    const embedding = deferred<void>()
    const client = makeClient()
    vi.mocked(client.embed).mockReturnValue(embedding.promise)
    const { result, unmount } = setup(client)

    let selecting!: Promise<void>
    await act(async () => {
      selecting = result.current.selectSubject()
    })
    expect(client.embed).toHaveBeenCalledTimes(1)

    unmount()
    expect(client.dispose).toHaveBeenCalledTimes(1)
    embedding.resolve()
    await selecting
    expect(client.segment).not.toHaveBeenCalled()
  })

  it('disposes a worker that finished loading after the editor closed', async () => {
    // A client whose load ignores dispose and settles later, as a slow worker.
    vi.mocked(loadSubjectModel).mockResolvedValue({
      encoder: new ArrayBuffer(8),
      decoder: new ArrayBuffer(8)
    })
    const loading = deferred<void>()
    const client = makeClient()
    vi.mocked(client.load).mockReturnValue(loading.promise)
    const { result, unmount } = setup(client)
    let selecting!: Promise<void>
    await act(async () => {
      selecting = result.current.selectSubject()
    })
    unmount()
    loading.resolve()
    await selecting
    expect(client.dispose).toHaveBeenCalled()
    expect(client.embed).not.toHaveBeenCalled()
  })

  it('does not report the aborted download as a failure', async () => {
    const download = deferred<{ encoder: ArrayBuffer; decoder: ArrayBuffer }>()
    vi.mocked(loadSubjectModel).mockReturnValue(download.promise)
    const { result, unmount } = setup(makeClient())
    let selecting!: Promise<void>
    await act(async () => {
      selecting = result.current.selectSubject()
    })
    unmount()
    download.reject(new DOMException('Aborted', 'AbortError'))
    await expect(selecting).resolves.toBeUndefined()
  })

  describe('the model status', () => {
    // The phase while the files are still on their way.
    const phaseWhileLoading = async (cached: boolean) => {
      vi.mocked(isModelCached).mockResolvedValue(cached)
      const download = deferred<{
        encoder: ArrayBuffer
        decoder: ArrayBuffer
      }>()
      vi.mocked(loadSubjectModel).mockImplementation((_, options) => {
        options?.onProgress?.({ loadedBytes: 4, totalBytes: 16, cached })
        return download.promise
      })
      const { result } = setup(makeClient())
      let selecting!: Promise<void>
      await act(async () => {
        selecting = result.current.selectSubject()
      })
      const phase = result.current.sam.phase
      download.resolve({
        encoder: new ArrayBuffer(8),
        decoder: new ArrayBuffer(8)
      })
      await act(async () => {
        await selecting
      })
      return phase
    }

    it('says getting ready, not downloading, when the model is cached', async () => {
      expect(await phaseWhileLoading(true)).toBe('preparing')
    })

    it('says downloading when bytes come over the network', async () => {
      expect(await phaseWhileLoading(false)).toBe('downloading')
    })
  })

  it('uses the brush for a stored subject when the model is off, and announces a tap', async () => {
    const stored = withRaster(
      addSubjectMask(NEUTRAL_RECIPE, 'aaaaaaaa', { x: 0.5, y: 0.5, label: 1 }),
      'aaaaaaaa',
      createRaster({ width: 8, height: 6 }, 255)
    )
    const onChange = vi.fn()
    const announce = vi.fn()
    const { result } = renderHook(() =>
      useMasks({
        recipe: stored,
        onChange,
        source: { width: 400, height: 300 },
        bitmap: BITMAP,
        focus: null,
        storedGeometry: null,
        model: null,
        disabled: false,
        announce,
        createClient: makeClient
      })
    )
    expect(result.current.mode).toBe('brush')

    await act(async () => {
      await result.current.tap({ x: 0.3, y: 0.3 })
    })

    // Said out loud, not dropped without a word.
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(/turned off on this server/)
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(loadSubjectModel).not.toHaveBeenCalled()
  })
})
