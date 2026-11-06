import { NextRequest } from 'next/server'

import { POST } from './route'

const shareRequest = (headers: Record<string, string> = {}) => {
  const form = new FormData()
  form.append('files', new File(['run'], 'run.fit'))
  return new NextRequest('https://llun.social/_share-target', {
    method: 'POST',
    body: form,
    headers
  })
}

describe('POST /_share-target (first-visit fallback)', () => {
  it('sends a browser-launched share to the composer notice without reading the body', async () => {
    const request = shareRequest({
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate'
    })
    const formData = vi.spyOn(request, 'formData')
    const arrayBuffer = vi.spyOn(request, 'arrayBuffer')
    const text = vi.spyOn(request, 'text')

    const response = POST(request)

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/app?shareUnavailable=1')
    expect(response.headers.get('Content-Security-Policy')).toBeTruthy()
    expect(formData).not.toHaveBeenCalled()
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
    expect(request.bodyUsed).toBe(false)
  })

  it.each<Record<string, string>>([{}, { 'sec-fetch-site': 'same-origin' }])(
    'treats %o as a share',
    (headers) => {
      expect(POST(shareRequest(headers)).headers.get('location')).toBe(
        '/app?shareUnavailable=1'
      )
    }
  )

  it.each([
    { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
    { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' },
    { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'cors' }
  ])('refuses %o with a plain redirect to /app', (headers) => {
    const response = POST(shareRequest(headers))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/app')
  })
})
