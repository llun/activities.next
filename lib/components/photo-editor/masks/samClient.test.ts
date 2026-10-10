import { createSamClient } from './samClient'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: unknown[] = []
  terminated = false
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(message: unknown) {
    this.posted.push(message)
  }
  terminate() {
    this.terminated = true
  }
  answer(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

describe('createSamClient', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
  })
  afterEach(() => vi.unstubAllGlobals())

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('runs requests one at a time, in order', async () => {
    const client = createSamClient()
    const [worker] = FakeWorker.instances
    const embed = client.embed({} as ImageBitmap)
    const segment = client.segment([{ x: 0.5, y: 0.5, label: 1 }])
    await flush()
    expect(worker.posted).toHaveLength(1)

    worker.answer({ type: 'embedded' })
    await embed
    await flush()
    expect(worker.posted).toHaveLength(2)
    worker.answer({
      type: 'mask',
      width: 2,
      height: 1,
      data: new Uint8Array(2)
    })
    await expect(segment).resolves.toMatchObject({ width: 2, height: 1 })
  })

  it('rejects the request in flight and every queued one when disposed', async () => {
    const client = createSamClient()
    const [worker] = FakeWorker.instances
    const first = client.embed({} as ImageBitmap)
    const second = client.segment([{ x: 0.5, y: 0.5, label: 1 }])
    const third = client.segment([{ x: 0.1, y: 0.1, label: 1 }])
    await flush()

    client.dispose()

    await expect(first).rejects.toThrow('The model was closed')
    await expect(second).rejects.toThrow('The model was closed')
    await expect(third).rejects.toThrow('The model was closed')
    expect(worker.terminated).toBe(true)
    // The queued requests never reached the ended worker.
    expect(worker.posted).toHaveLength(1)
  })

  it('rejects a request made before the first one started when disposed at once', async () => {
    const client = createSamClient()
    const [worker] = FakeWorker.instances
    const request = client.segment([{ x: 0.5, y: 0.5, label: 1 }])
    client.dispose()
    await expect(request).rejects.toThrow('The model was closed')
    expect(worker.posted).toHaveLength(0)
  })

  it('rejects a request made after dispose', async () => {
    const client = createSamClient()
    client.dispose()
    await expect(client.segment([])).rejects.toThrow('The model was closed')
  })
})
