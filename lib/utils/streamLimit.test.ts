import { readResponseArrayBufferWithLimit } from './streamLimit'

describe('readResponseArrayBufferWithLimit', () => {
  it('rejects non-streaming responses without a safe content length before buffering', async () => {
    const response = {
      headers: new Headers(),
      body: null,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(2048))
    } as unknown as Response

    await expect(
      readResponseArrayBufferWithLimit(response, 1024, 'Fallback body')
    ).rejects.toThrow('Unable to safely read Fallback body without streaming')
    expect(response.arrayBuffer).not.toHaveBeenCalled()
  })

  it('allows non-streaming responses with a content length within the limit', async () => {
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer
    const response = {
      headers: new Headers({ 'content-length': '3' }),
      body: null,
      arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer)
    } as unknown as Response

    const result = await readResponseArrayBufferWithLimit(
      response,
      1024,
      'Fallback body'
    )

    expect([...new Uint8Array(result)]).toEqual([
      ...new Uint8Array(arrayBuffer)
    ])
  })

  it('cancels streaming responses when the byte limit is exceeded', async () => {
    const cancel = vi.fn()
    const response = {
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]))
          controller.enqueue(new Uint8Array([3, 4]))
        },
        cancel
      })
    } as unknown as Response

    await expect(
      readResponseArrayBufferWithLimit(response, 3, 'Streaming body')
    ).rejects.toThrow('Streaming body exceeds byte limit of 3 bytes')

    expect(cancel).toHaveBeenCalled()
  })

  // The declared-length refusal never reads the body, so without an explicit
  // cancel the connection stays open until the caller's own timeout fires. A
  // caller looping over attacker-supplied URLs refuses each in milliseconds
  // and would strand one socket per refusal, up to EMFILE.
  it('cancels the body when the declared content length exceeds the limit', async () => {
    const cancel = vi.fn()
    const response = {
      headers: new Headers({ 'content-length': '4096' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]))
        },
        cancel
      })
    } as unknown as Response

    await expect(
      readResponseArrayBufferWithLimit(response, 1024, 'Declared body')
    ).rejects.toThrow('Declared body exceeds byte limit of 1024 bytes')

    expect(cancel).toHaveBeenCalled()
  })
})
