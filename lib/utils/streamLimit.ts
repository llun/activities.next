import { Transform, TransformCallback } from 'stream'

export const SAFE_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024

export class StreamByteLimitError extends Error {
  constructor(label: string, maxBytes: number) {
    super(`${label} exceeds byte limit of ${maxBytes} bytes`)
    this.name = 'StreamByteLimitError'
  }
}

export const assertByteLengthWithinLimit = ({
  byteLength,
  maxBytes,
  label
}: {
  byteLength: number | undefined
  maxBytes: number
  label: string
}) => {
  if (
    typeof byteLength === 'number' &&
    Number.isFinite(byteLength) &&
    byteLength > maxBytes
  ) {
    throw new StreamByteLimitError(label, maxBytes)
  }
}

const getSafeResponseContentLength = (
  response: Pick<Response, 'headers'>,
  maxBytes: number,
  label: string
): number | null => {
  const contentLength = response.headers.get('content-length')
  if (!contentLength) {
    return null
  }

  const parsedLength = Number(contentLength)
  if (!Number.isFinite(parsedLength) || parsedLength < 0) {
    return null
  }

  assertByteLengthWithinLimit({
    byteLength: parsedLength,
    maxBytes,
    label
  })
  return parsedLength
}

const bufferToArrayBuffer = (buffer: Buffer): ArrayBuffer => {
  if (
    buffer.byteOffset === 0 &&
    buffer.byteLength === buffer.buffer.byteLength
  ) {
    return buffer.buffer as ArrayBuffer
  }

  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
}

const toBuffer = (chunk: unknown): Buffer => {
  if (Buffer.isBuffer(chunk)) {
    return chunk
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk)
  }
  return Buffer.from(String(chunk))
}

export const readAsyncIterableToBufferWithLimit = async (
  stream: AsyncIterable<unknown>,
  maxBytes: number,
  label = 'Stream'
): Promise<Buffer> => {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of stream) {
    const buffer = toBuffer(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > maxBytes) {
      throw new StreamByteLimitError(label, maxBytes)
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks, totalBytes)
}

export const readUnknownBodyToBufferWithLimit = async (
  body: unknown,
  maxBytes: number,
  label = 'Stream'
): Promise<Buffer> => {
  if (body && Symbol.asyncIterator in Object(body)) {
    return readAsyncIterableToBufferWithLimit(
      body as AsyncIterable<unknown>,
      maxBytes,
      label
    )
  }

  if (
    body &&
    typeof body === 'object' &&
    'transformToByteArray' in body &&
    typeof (body as { transformToByteArray: () => Promise<Uint8Array> })
      .transformToByteArray === 'function'
  ) {
    const buffer = Buffer.from(
      await (
        body as { transformToByteArray: () => Promise<Uint8Array> }
      ).transformToByteArray()
    )
    assertByteLengthWithinLimit({
      byteLength: buffer.byteLength,
      maxBytes,
      label
    })
    return buffer
  }

  throw new Error(`Unable to read ${label}`)
}

export const readResponseArrayBufferWithLimit = async (
  response: Response,
  maxBytes = SAFE_DOWNLOAD_MAX_BYTES,
  label = 'Response body'
): Promise<ArrayBuffer> => {
  const safeContentLength = getSafeResponseContentLength(
    response,
    maxBytes,
    label
  )

  if (!response.body || typeof response.body.getReader !== 'function') {
    if (safeContentLength === null) {
      throw new Error(`Unable to safely read ${label} without streaming`)
    }

    const arrayBuffer = await response.arrayBuffer()
    assertByteLengthWithinLimit({
      byteLength: arrayBuffer.byteLength,
      maxBytes,
      label
    })
    return arrayBuffer
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      const buffer = Buffer.from(value)
      totalBytes += buffer.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new StreamByteLimitError(label, maxBytes)
      }
      chunks.push(buffer)
    }
  } finally {
    reader.releaseLock()
  }

  const buffer = Buffer.concat(chunks, totalBytes)
  return bufferToArrayBuffer(buffer)
}

export class ByteLimitTransform extends Transform {
  private _totalBytes = 0
  private _maxBytes: number
  private _label: string

  constructor(maxBytes: number, label = 'Stream') {
    super()
    this._maxBytes = maxBytes
    this._label = label
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
    this._totalBytes += chunk.byteLength
    if (this._totalBytes > this._maxBytes) {
      callback(new StreamByteLimitError(this._label, this._maxBytes))
      return
    }

    callback(null, chunk)
  }
}

export const createByteLimitTransform = (maxBytes: number, label = 'Stream') =>
  new ByteLimitTransform(maxBytes, label)
