import { NextRequest } from 'next/server'

/**
 * Gets and parses the request body based on content type
 * Automatically handles both JSON and form data requests
 *
 * @param req NextRequest object
 * @returns Parsed request body as Record<string, unknown>
 */
export async function getRequestBody(
  req: NextRequest
): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return req.json()
  }

  // Parse urlencoded bodies with URLSearchParams rather than formData(): it is
  // cheaper and, unlike req.formData(), works on the synthetic request bodies
  // used in tests. multipart/form-data still needs the formData() parser.
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(await req.text()))
  }

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    return Object.fromEntries(formData.entries())
  }

  // No body or an unrecognized content type: nothing to parse. Returning an
  // empty object (rather than calling req.formData(), which rejects on a
  // bodyless/typeless request) lets endpoints that read optional params handle
  // a paramless POST without erroring.
  return {}
}
