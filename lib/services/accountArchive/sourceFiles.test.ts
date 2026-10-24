import http from 'http'
import type { AddressInfo } from 'net'
import { Readable } from 'stream'

import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'

import { openMediaSourceFile, readWithIdleTimeout } from './sourceFiles'

describe('openMediaSourceFile on object storage', () => {
  let answers: number[]
  let requests: number
  let server: http.Server

  beforeEach(async () => {
    answers = []
    requests = 0
    server = http.createServer((_req, res) => {
      requests += 1
      const status = answers.shift() ?? 200
      res.statusCode = status
      res.setHeader('content-type', 'application/octet-stream')
      res.end(
        status === 200
          ? 'PHOTO'
          : `<Error><Code>${
              status === 404
                ? 'NoSuchKey'
                : status === 401
                  ? 'RequestTimeTooSkewed'
                  : 'AccessDenied'
            }</Code></Error>`
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    // CI has no AWS credentials; static ones keep the default provider chain
    // from failing before the request is made.
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test')
    vi.mocked(getConfig).mockReturnValue({
      ...getConfig(),
      mediaStorage: {
        type: MediaStorageType.S3Storage,
        bucket: 'bucket',
        region: 'us-east-1',
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      }
    } as ReturnType<typeof getConfig>)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  const read = async (path: string) => {
    const outcome = await openMediaSourceFile(path)
    if (!outcome.ok) return outcome
    const chunks: Buffer[] = []
    for await (const chunk of outcome.file.stream) {
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks).toString()
  }

  it('fails the slice on a server error, and the retry includes the file', async () => {
    answers = [503]
    // The client makes a single attempt: the error must reach the slice, so it
    // is retried, instead of leaving the file out of the archive.
    await expect(read('medias/2026/a.jpg')).rejects.toBeTruthy()
    expect(requests).toBe(1)

    expect(await read('medias/2026/a.jpg')).toBe('PHOTO')
  })

  it('rethrows a throttling answer too', async () => {
    answers = [429]
    await expect(read('medias/2026/a.jpg')).rejects.toBeTruthy()
  })

  it('rethrows clock skew, which a later attempt gets past', async () => {
    answers = [401]
    await expect(read('medias/2026/a.jpg')).rejects.toMatchObject({
      name: 'RequestTimeTooSkewed'
    })
  })

  it('still skips a file that cannot be read for good', async () => {
    answers = [403, 404]
    expect(await read('medias/2026/a.jpg')).toEqual({
      ok: false,
      reason: 'failed'
    })
    expect(await read('medias/2026/b.jpg')).toEqual({
      ok: false,
      reason: 'missing'
    })
  })
})

describe('readWithIdleTimeout', () => {
  it('passes the chunks of a stream that keeps sending', async () => {
    const chunks: Buffer[] = []
    for await (const chunk of readWithIdleTimeout(
      Readable.from([Buffer.from('ab'), Buffer.from('cd')]),
      1000
    )) {
      chunks.push(chunk)
    }
    expect(Buffer.concat(chunks).toString()).toBe('abcd')
  })

  it('rejects a body that stalls after its first bytes, and closes the stream', async () => {
    // Sends its first bytes, then nothing and no end.
    const stalled = new Readable({ read() {} })
    stalled.push(Buffer.from('head'))
    const started = Date.now()
    const read = async () => {
      const seen: string[] = []
      for await (const chunk of readWithIdleTimeout(stalled, 150)) {
        seen.push(chunk.toString())
      }
      return seen
    }
    await expect(read()).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(Date.now() - started).toBeLessThan(1500)
    expect(stalled.destroyed).toBe(true)
  })

  it('does not count the time the caller spends with a chunk', async () => {
    const chunks: string[] = []
    for await (const chunk of readWithIdleTimeout(
      Readable.from([Buffer.from('a'), Buffer.from('b')]),
      100
    )) {
      chunks.push(chunk.toString())
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    expect(chunks).toEqual(['a', 'b'])
  })
})
