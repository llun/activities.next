export class AltTextProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AltTextProviderError'
  }
}

/**
 * Parses a backend response body, turning a malformed payload into an
 * `AltTextProviderError`.
 */
export const parseAltTextJson = <T>(body: string): T => {
  try {
    return JSON.parse(body) as T
  } catch {
    throw new AltTextProviderError('Alt text backend returned invalid JSON')
  }
}
