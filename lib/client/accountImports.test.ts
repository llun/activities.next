import { afterEach, describe, expect, it, vi } from 'vitest'

import { uploadAccountImport } from './accountImports'
import { ApiRequestError } from './http'

class FakeXMLHttpRequest {
  static latest: FakeXMLHttpRequest
  readonly upload = {
    addEventListener: (
      type: string,
      listener: (event: ProgressEvent) => void
    ) => {
      this.uploadListeners.set(type, listener)
    }
  }
  method = ''
  url = ''
  withCredentials = false
  status = 0
  responseText = ''
  body: Document | XMLHttpRequestBodyInit | null = null
  requestHeaders: Record<string, string> = {}
  listeners = new Map<string, (event: Event) => void>()
  uploadListeners = new Map<string, (event: ProgressEvent) => void>()

  constructor() {
    FakeXMLHttpRequest.latest = this
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, listener)
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body
  }

  abort() {
    this.listeners.get('abort')?.(new Event('abort'))
  }

  progress(loaded: number, total: number) {
    this.uploadListeners.get('progress')?.({
      loaded,
      total,
      lengthComputable: true
    } as ProgressEvent)
  }

  respond(status: number, body = '', retryAfter: string | null = null) {
    this.status = status
    this.responseText = body
    const event = new Event('load') as ProgressEvent
    Object.defineProperty(event, 'target', { value: this })
    if (retryAfter) {
      this.getResponseHeader = (name: string) =>
        name.toLowerCase() === 'retry-after' ? retryAfter : null
    }
    this.listeners.get('load')?.(event)
  }

  getResponseHeader(_name: string): string | null {
    return null
  }
}

describe('account archive upload client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses a credential-free PUT without custom headers for a presigned upload', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    const onProgress = vi.fn()
    const file = new File(['archive'], 'backup.zip', {
      type: 'application/zip'
    })
    const uploading = uploadAccountImport({
      actorId: 'actor-1',
      file,
      uploadUrl: 'https://storage.example/upload?signature=secret',
      directUploadPath: null,
      onProgress
    })
    const xhr = FakeXMLHttpRequest.latest
    xhr.progress(3, 7)
    xhr.respond(200)

    await expect(uploading).resolves.toBeUndefined()
    expect(xhr.method).toBe('PUT')
    expect(xhr.url).toBe('https://storage.example/upload?signature=secret')
    expect(xhr.withCredentials).toBe(false)
    expect(xhr.requestHeaders).toEqual({})
    expect(xhr.body).toBe(file)
    expect(onProgress).toHaveBeenCalledWith({ loaded: 3, total: 7 })
  })

  it('posts a raw ZIP to the direct route with actor scope and application/zip', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    const file = new File(['archive'], 'backup.zip', {
      type: 'application/zip'
    })
    const uploading = uploadAccountImport({
      actorId: 'actor/1',
      file,
      uploadUrl: null,
      directUploadPath: '/api/v1/account/imports/import-1'
    })
    const xhr = FakeXMLHttpRequest.latest
    xhr.respond(202, JSON.stringify({ id: 'import-1' }))

    await expect(uploading).resolves.toBeUndefined()
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/v1/account/imports/import-1?actorId=actor%2F1')
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.requestHeaders).toEqual({ 'Content-Type': 'application/zip' })
    expect(xhr.body).toBe(file)
  })

  it('rejects failed uploads as ApiRequestError with the server message', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    const uploading = uploadAccountImport({
      actorId: 'actor-1',
      file: new File(['archive'], 'backup.zip'),
      uploadUrl: null,
      directUploadPath: '/api/v1/account/imports/import-1'
    })
    FakeXMLHttpRequest.latest.respond(
      503,
      JSON.stringify({ error: 'Could not store archive upload' })
    )

    await expect(uploading).rejects.toBeInstanceOf(ApiRequestError)
    await expect(uploading).rejects.toMatchObject({
      status: 503,
      message: 'Could not store archive upload'
    })
  })

  it('rejects an aborted upload instead of retrying it', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
    const uploading = uploadAccountImport({
      actorId: 'actor-1',
      file: new File(['archive'], 'backup.zip'),
      uploadUrl: null,
      directUploadPath: '/api/v1/account/imports/import-1'
    })
    FakeXMLHttpRequest.latest.abort()

    await expect(uploading).rejects.toMatchObject({ status: 0 })
  })
})
