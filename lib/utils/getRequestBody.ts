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

  const formData = await req.formData()
  return Object.fromEntries(formData.entries())
}
