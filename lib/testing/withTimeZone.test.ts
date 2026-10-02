import { Worker, isMainThread } from 'node:worker_threads'

import { withTimeZone } from './withTimeZone'

const currentTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

// 2026-05-25 is in summer time, so Europe/Amsterdam is two hours ahead of UTC.
const offsetInMay = () => new Date(2026, 4, 25).getTimezoneOffset()

describe('withTimeZone', () => {
  it('runs in a forked process, which vitest.config.ts routes this file to', () => {
    expect(isMainThread).toBe(true)
  })

  it('moves Date and Intl to the zone for the callback', async () => {
    const seen = await withTimeZone('Europe/Amsterdam', () => ({
      timeZone: currentTimeZone(),
      offset: offsetInMay()
    }))

    expect(seen).toEqual({ timeZone: 'Europe/Amsterdam', offset: -120 })
  })

  it('awaits an async callback before restoring the zone', async () => {
    const seen = await withTimeZone('Asia/Tokyo', async () => {
      await Promise.resolve()
      return offsetInMay()
    })

    expect(seen).toBe(-540)
    expect(currentTimeZone()).toBe('UTC')
  })

  it('restores the zone when the callback throws', async () => {
    await expect(
      withTimeZone('Europe/Amsterdam', () => {
        throw new Error('callback failed')
      })
    ).rejects.toThrow('callback failed')

    expect(process.env.TZ).toBe('UTC')
    expect(currentTimeZone()).toBe('UTC')
    expect(offsetInMay()).toBe(0)
  })

  it('accepts an alias, which Intl reports under its canonical name', async () => {
    // Intl names Asia/Kolkata `Asia/Calcutta`; comparing against the request
    // as typed would reject it as a zone that did not move.
    const seen = await withTimeZone('Asia/Kolkata', () => offsetInMay())

    expect(seen).toBe(-330)
  })

  it('throws instead of running the callback when the zone name is not recognised', async () => {
    const callback = vi.fn()

    await expect(withTimeZone('Not/AZone', callback)).rejects.toThrow(
      RangeError
    )

    expect(callback).not.toHaveBeenCalled()
    expect(process.env.TZ).toBe('UTC')
    expect(currentTimeZone()).toBe('UTC')
  })

  it('puts back the zone it found rather than the suite default', async () => {
    const seen = await withTimeZone('Asia/Tokyo', async () => {
      await withTimeZone('Europe/Amsterdam', () => undefined)
      return currentTimeZone()
    })

    expect(seen).toBe('Asia/Tokyo')
  })

  it('puts back an unset TZ as unset, not as the string "undefined"', async () => {
    const pinned = process.env.TZ
    delete process.env.TZ
    try {
      const machineZone = currentTimeZone()

      await withTimeZone('Asia/Tokyo', () => undefined)

      expect(process.env.TZ).toBeUndefined()
      expect(currentTimeZone()).toBe(machineZone)
    } finally {
      process.env.TZ = pinned
    }
  })

  it('throws on a worker thread, where Node ignores TZ, instead of running the callback', async () => {
    // A bare worker, not a Vitest one: it loads the helper through Node's own
    // type stripping, so withTimeZone.ts has to stay free of project imports.
    const source = `
      const { parentPort, workerData } = require('node:worker_threads')
      import(workerData.helperUrl).then(async ({ withTimeZone }) => {
        let callbackRan = false
        const error = await withTimeZone('Asia/Tokyo', () => {
          callbackRan = true
        }).then(
          () => null,
          (err) => err.message
        )
        parentPort.postMessage({ callbackRan, error })
      })
    `
    const outcome = await new Promise<{
      callbackRan: boolean
      error: string | null
    }>((resolve, reject) => {
      const worker = new Worker(source, {
        eval: true,
        workerData: {
          helperUrl: new URL('./withTimeZone.ts', import.meta.url).href
        }
      })
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', (code) =>
        reject(new Error(`the worker exited (${code}) without reporting`))
      )
    })

    expect(outcome.callbackRan).toBe(false)
    expect(outcome.error).toContain(
      'could not move the time zone to "Asia/Tokyo"'
    )
    expect(outcome.error).toContain('worker thread')
  })
})
