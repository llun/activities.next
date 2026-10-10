import {
  MODEL_CACHE_NAME,
  ModelIntegrityError,
  type SubjectModel,
  formatModelSize,
  getModelBytes,
  isModelCached,
  loadSubjectModel,
  sha256Hex
} from './modelCache'

const encode = (text: string) =>
  new TextEncoder().encode(text).buffer as ArrayBuffer

const makeModel = async (
  encoderText = 'encoder bytes',
  decoderText = 'decoder bytes!'
): Promise<SubjectModel> => {
  const encoder = encode(encoderText)
  const decoder = encode(decoderText)
  return {
    baseUrl: 'https://models.test/slimsam/',
    files: {
      encoder: {
        path: 'onnx/encoder.onnx',
        bytes: encoder.byteLength,
        sha256: await sha256Hex(encoder)
      },
      decoder: {
        path: 'onnx/decoder.onnx',
        bytes: decoder.byteLength,
        sha256: await sha256Hex(decoder)
      }
    }
  }
}

/** A Cache Storage stand-in keyed by request URL. */
const makeCaches = () => {
  const entries = new Map<string, Response>()
  const cache = {
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response)
    }),
    delete: vi.fn(async (request: Request) => entries.delete(request.url))
  }
  const opened: string[] = []
  vi.stubGlobal('caches', {
    open: vi.fn(async (name: string) => {
      opened.push(name)
      return cache
    })
  })
  return { entries, cache, opened }
}

const serve = (files: Record<string, ArrayBuffer>) =>
  vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const body = files[new URL(String(url)).pathname.replace('/slimsam/', '')]
    return body
      ? new Response(body.slice(0), { status: 200 })
      : new Response('missing', { status: 404 })
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadSubjectModel', () => {
  it('downloads both files, checks them and stores them under their hash', async () => {
    const { entries, opened } = makeCaches()
    const model = await makeModel()
    const fetchMock = serve({
      'onnx/encoder.onnx': encode('encoder bytes'),
      'onnx/decoder.onnx': encode('decoder bytes!')
    })
    vi.stubGlobal('fetch', fetchMock)

    const loaded = await loadSubjectModel(model)

    expect(new TextDecoder().decode(loaded.encoder)).toBe('encoder bytes')
    expect(new TextDecoder().decode(loaded.decoder)).toBe('decoder bytes!')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://models.test/slimsam/onnx/encoder.onnx'
    )
    expect(opened).toEqual([MODEL_CACHE_NAME])
    expect([...entries.keys()].map((url) => url.split('/').pop())).toEqual([
      model.files.encoder.sha256,
      model.files.decoder.sha256
    ])
  })

  it('does not send credentials to the model host', async () => {
    makeCaches()
    const model = await makeModel()
    const fetchMock = serve({
      'onnx/encoder.onnx': encode('encoder bytes'),
      'onnx/decoder.onnx': encode('decoder bytes!')
    })
    vi.stubGlobal('fetch', fetchMock)
    await loadSubjectModel(model)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
  })

  it('rejects a file whose sha256 does not match, and caches nothing', async () => {
    const { entries } = makeCaches()
    const model = await makeModel()
    vi.stubGlobal(
      'fetch',
      serve({
        // Same length, different bytes.
        'onnx/encoder.onnx': encode('encoder BYTES'),
        'onnx/decoder.onnx': encode('decoder bytes!')
      })
    )

    const error = await loadSubjectModel(model).catch((e) => e)

    expect(error).toBeInstanceOf(ModelIntegrityError)
    expect(error.message).toMatch(/checksum/)
    expect(entries.size).toBe(0)
  })

  it('rejects a file of the wrong size', async () => {
    makeCaches()
    const model = await makeModel()
    vi.stubGlobal(
      'fetch',
      serve({
        'onnx/encoder.onnx': encode('encoder bytes and more'),
        'onnx/decoder.onnx': encode('decoder bytes!')
      })
    )
    await expect(loadSubjectModel(model)).rejects.toThrow(/wrong size/)
  })

  it('fails on a download error', async () => {
    makeCaches()
    const model = await makeModel()
    vi.stubGlobal('fetch', serve({}))
    await expect(loadSubjectModel(model)).rejects.toThrow(/404/)
  })

  it('serves the second load from the cache without a request', async () => {
    makeCaches()
    const model = await makeModel()
    const fetchMock = serve({
      'onnx/encoder.onnx': encode('encoder bytes'),
      'onnx/decoder.onnx': encode('decoder bytes!')
    })
    vi.stubGlobal('fetch', fetchMock)
    await loadSubjectModel(model)
    fetchMock.mockClear()

    const progress = vi.fn()
    const loaded = await loadSubjectModel(model, { onProgress: progress })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(new TextDecoder().decode(loaded.decoder)).toBe('decoder bytes!')
    expect(progress).toHaveBeenLastCalledWith({
      loadedBytes: getModelBytes(model),
      totalBytes: getModelBytes(model),
      cached: true
    })
    await expect(isModelCached(model)).resolves.toBe(true)
  })

  it('drops a cached copy that no longer matches and downloads it again', async () => {
    const { entries } = makeCaches()
    const model = await makeModel()
    const fetchMock = serve({
      'onnx/encoder.onnx': encode('encoder bytes'),
      'onnx/decoder.onnx': encode('decoder bytes!')
    })
    vi.stubGlobal('fetch', fetchMock)
    await loadSubjectModel(model)
    // Something replaced the stored encoder with other bytes of the same size.
    const key = [...entries.keys()][0]
    entries.set(key, new Response(encode('xxxxxxxxxxxxx')))
    fetchMock.mockClear()

    const loaded = await loadSubjectModel(model)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new TextDecoder().decode(loaded.encoder)).toBe('encoder bytes')
  })

  it('reports progress up to the full size while downloading', async () => {
    makeCaches()
    const model = await makeModel()
    vi.stubGlobal(
      'fetch',
      serve({
        'onnx/encoder.onnx': encode('encoder bytes'),
        'onnx/decoder.onnx': encode('decoder bytes!')
      })
    )
    const progress = vi.fn()
    await loadSubjectModel(model, { onProgress: progress })
    const last = progress.mock.calls.at(-1)?.[0]
    expect(last).toEqual({
      loadedBytes: getModelBytes(model),
      totalBytes: getModelBytes(model),
      cached: false
    })
    const loaded = progress.mock.calls.map(([p]) => p.loadedBytes)
    expect([...loaded].sort((a, b) => a - b)).toEqual(loaded)
  })

  it('works when Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined)
    const model = await makeModel()
    vi.stubGlobal(
      'fetch',
      serve({
        'onnx/encoder.onnx': encode('encoder bytes'),
        'onnx/decoder.onnx': encode('decoder bytes!')
      })
    )
    await expect(loadSubjectModel(model)).resolves.toBeDefined()
    await expect(isModelCached(model)).resolves.toBe(false)
  })
})

describe('formatModelSize', () => {
  it.each([
    [13_785_975, '14 MB'],
    [400_000, '1 MB'],
    [250_000_000, '250 MB']
  ])('formats %i bytes as %s', (bytes, text) => {
    expect(formatModelSize(bytes)).toBe(text)
  })
})
