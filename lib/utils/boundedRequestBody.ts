import {
  StreamByteLimitError,
  assertByteLengthWithinLimit,
  readUnknownBodyToBufferWithLimit
} from '@/lib/utils/streamLimit'

/**
 * Cap for the small JSON / form bodies public endpoints accept (webhooks,
 * client registration). Real payloads are a few hundred bytes.
 */
export const SMALL_REQUEST_BODY_MAX_BYTES = 64 * 1024

export { StreamByteLimitError as RequestBodyTooLargeError }

export const isRequestBodyTooLargeError = (
  error: unknown
): error is StreamByteLimitError => error instanceof StreamByteLimitError

/**
 * Reads a request body into memory but never more than `maxBytes`.
 *
 * `req.json()` / `req.text()` / `req.formData()` buffer the whole body before a
 * caller can look at it, so an unauthenticated route that parses first can be
 * made to allocate arbitrarily much. This rejects on a declared
 * `content-length` over the cap before reading anything, then enforces the cap
 * on the actual stream (a client can omit or lie about the header, and chunked
 * bodies carry none) and cancels the rest.
 *
 * @throws RequestBodyTooLargeError when the body exceeds `maxBytes`
 */
export const readRequestBodyWithLimit = async (
  req: Request,
  maxBytes: number,
  label = 'Request body'
): Promise<Buffer> => {
  const declared = req.headers.get('content-length')
  if (declared !== null && declared.trim() !== '') {
    assertByteLengthWithinLimit({
      byteLength: Number(declared),
      maxBytes,
      label
    })
  }

  if (!req.body) return Buffer.alloc(0)
  return readUnknownBodyToBufferWithLimit(req.body, maxBytes, label)
}

export const readRequestTextWithLimit = async (
  req: Request,
  maxBytes: number,
  label = 'Request body'
): Promise<string> =>
  (await readRequestBodyWithLimit(req, maxBytes, label)).toString('utf-8')
