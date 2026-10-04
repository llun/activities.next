import { isAbortError } from './isAbortError'

describe('isAbortError', () => {
  it.each([
    {
      description: 'an aborted signal',
      error: (() => {
        const controller = new AbortController()
        controller.abort()
        return controller.signal.reason
      })()
    },
    {
      description: 'a DOMException named AbortError',
      error: new DOMException('Aborted', 'AbortError')
    },
    {
      description: 'an Error named AbortError',
      error: Object.assign(new Error('Aborted'), { name: 'AbortError' })
    }
  ])('is true for $description', ({ error }) => {
    expect(isAbortError(error)).toBe(true)
  })

  it.each([
    {
      description: 'a network failure',
      error: new TypeError('Failed to fetch')
    },
    {
      description: 'another DOMException',
      error: new DOMException('Timed out', 'TimeoutError')
    },
    { description: 'a string', error: 'AbortError' },
    { description: 'nothing', error: undefined }
  ])('is false for $description', ({ error }) => {
    expect(isAbortError(error)).toBe(false)
  })
})
