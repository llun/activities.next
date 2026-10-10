/**
 * Downloads the segmentation model, checks it, and keeps it in Cache Storage
 * so it is fetched once per browser. The file names, sizes and sha256 come
 * from the server (`capabilities.subjectModel`); a file that does not match
 * is an error and is never cached or used.
 */

export const MODEL_CACHE_NAME = 'photo-editor-models-v1'

export interface ModelFile {
  path: string
  bytes: number
  sha256: string
}

export interface SubjectModel {
  /** Ends with "/". */
  baseUrl: string
  files: { encoder: ModelFile; decoder: ModelFile }
}

export interface ModelProgress {
  loadedBytes: number
  totalBytes: number
  /** True once the files came from the cache and nothing was downloaded. */
  cached: boolean
}

export class ModelIntegrityError extends Error {
  constructor(
    public readonly file: string,
    reason: string
  ) {
    super(`The model file ${file} ${reason}`)
    this.name = 'ModelIntegrityError'
  }
}

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')

export const sha256Hex = async (data: ArrayBuffer): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', data))

/** The cache key of a file: its hash, as a URL on this origin. */
const cacheKey = (file: ModelFile) =>
  new Request(
    `${typeof location === 'undefined' ? 'https://localhost' : location.origin}/__photo-editor-model/${file.sha256}`
  )

/** Total bytes to fetch for a model. */
export const getModelBytes = (model: SubjectModel): number =>
  model.files.encoder.bytes + model.files.decoder.bytes

/** "14 MB", rounded to a whole number of megabytes (at least 1). */
export const formatModelSize = (bytes: number): string =>
  `${Math.max(1, Math.round(bytes / 1_000_000))} MB`

const verify = async (file: ModelFile, data: ArrayBuffer) => {
  if (data.byteLength !== file.bytes) {
    throw new ModelIntegrityError(file.path, 'has the wrong size')
  }
  if ((await sha256Hex(data)) !== file.sha256) {
    throw new ModelIntegrityError(file.path, 'does not match its checksum')
  }
}

const readBody = async (
  response: Response,
  onChunk: (bytes: number) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> => {
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    onChunk(buffer.byteLength)
    return buffer
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel()
      throw new DOMException('Aborted', 'AbortError')
    }
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.byteLength
    onChunk(value.byteLength)
  }
  const merged = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

const openCache = async (): Promise<Cache | null> => {
  try {
    return typeof caches === 'undefined'
      ? null
      : await caches.open(MODEL_CACHE_NAME)
  } catch {
    // Private windows and blocked storage: download every time.
    return null
  }
}

export interface LoadedModel {
  encoder: ArrayBuffer
  decoder: ArrayBuffer
}

/**
 * Returns the two model files, from Cache Storage when they are there and
 * still match, else downloaded (with progress) and cached. A cached copy that
 * fails the check is dropped and fetched again.
 */
export const loadSubjectModel = async (
  model: SubjectModel,
  options: {
    onProgress?: (progress: ModelProgress) => void
    signal?: AbortSignal
  } = {}
): Promise<LoadedModel> => {
  const { onProgress, signal } = options
  const totalBytes = getModelBytes(model)
  const cache = await openCache()
  let loadedBytes = 0
  let downloaded = false
  const report = () =>
    onProgress?.({ loadedBytes, totalBytes, cached: !downloaded })

  const fetchOne = async (file: ModelFile): Promise<ArrayBuffer> => {
    const key = cacheKey(file)
    if (cache) {
      const hit = await cache.match(key)
      if (hit) {
        const data = await hit.arrayBuffer()
        try {
          await verify(file, data)
          loadedBytes += data.byteLength
          report()
          return data
        } catch {
          await cache.delete(key)
        }
      }
    }
    downloaded = true
    const response = await fetch(new URL(file.path, model.baseUrl).href, {
      credentials: 'omit',
      signal
    })
    if (!response.ok) {
      throw new Error(`The model could not be downloaded (${response.status})`)
    }
    let own = 0
    const data = await readBody(
      response,
      (bytes) => {
        own += bytes
        loadedBytes += bytes
        report()
      },
      signal
    )
    // A re-download after a failed attempt must not count twice.
    await verify(file, data).catch((error) => {
      loadedBytes -= own
      throw error
    })
    if (cache) {
      await cache
        .put(key, new Response(data.slice(0), { status: 200 }))
        .catch(() => undefined)
    }
    return data
  }

  report()
  // One after the other: the progress bar fills in order and memory stays low.
  const encoder = await fetchOne(model.files.encoder)
  const decoder = await fetchOne(model.files.decoder)
  return { encoder, decoder }
}

/** True when both files are already in Cache Storage (no download needed). */
export const isModelCached = async (model: SubjectModel): Promise<boolean> => {
  const cache = await openCache()
  if (!cache) return false
  const hits = await Promise.all([
    cache.match(cacheKey(model.files.encoder)),
    cache.match(cacheKey(model.files.decoder))
  ])
  return hits.every(Boolean)
}
