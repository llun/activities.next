import { NextRequest } from 'next/server'

import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_429 } from '@/lib/utils/response'

// The real window counter, not a stub: these tests pin the limit, the window
// and the key. The counter lives in module state, so each test loads a fresh
// copy of the module.
const loadSupport = async () => {
  vi.resetModules()
  return import('@/lib/services/gallery/galleryAlbumRouteSupport')
}

describe('tryAlbumWrite', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets an actor write 120 times a minute and refuses the 121st', async () => {
    const { tryAlbumWrite } = await loadSupport()

    for (let hit = 1; hit <= 120; hit += 1) {
      expect(tryAlbumWrite('https://llun.test/users/a')).toBeTrue()
    }

    expect(tryAlbumWrite('https://llun.test/users/a')).toBeFalse()
    // Still refused, and a refused write is not counted.
    expect(tryAlbumWrite('https://llun.test/users/a')).toBeFalse()
  })

  it('counts each actor on its own, so one busy actor does not slow another', async () => {
    const { tryAlbumWrite } = await loadSupport()
    for (let hit = 0; hit < 121; hit += 1) {
      tryAlbumWrite('https://llun.test/users/busy')
    }
    expect(tryAlbumWrite('https://llun.test/users/busy')).toBeFalse()

    expect(tryAlbumWrite('https://llun.test/users/quiet')).toBeTrue()
    for (let hit = 1; hit < 120; hit += 1) {
      expect(tryAlbumWrite('https://llun.test/users/quiet')).toBeTrue()
    }
    expect(tryAlbumWrite('https://llun.test/users/quiet')).toBeFalse()
  })

  it('opens a new window after 60 seconds', async () => {
    const { tryAlbumWrite } = await loadSupport()
    for (let hit = 0; hit < 120; hit += 1) tryAlbumWrite('actor')
    expect(tryAlbumWrite('actor')).toBeFalse()

    vi.advanceTimersByTime(59_999)
    expect(tryAlbumWrite('actor')).toBeFalse()

    vi.advanceTimersByTime(1)
    expect(tryAlbumWrite('actor')).toBeTrue()
    // A full new allowance, not one hit.
    for (let hit = 1; hit < 120; hit += 1) {
      expect(tryAlbumWrite('actor')).toBeTrue()
    }
    expect(tryAlbumWrite('actor')).toBeFalse()
  })
})

describe('public album reads', () => {
  const request = (headers: Record<string, string> = {}) =>
    new NextRequest('https://llun.test/api/v1/accounts/1/gallery/albums', {
      headers
    })

  describe('getAlbumReadKey', () => {
    const loadWithTrust = async (trusted: boolean) => {
      vi.resetModules()
      vi.doMock('@/lib/config/trustProxyIpHeaders', () => ({
        getTrustProxyIpHeadersConfig: () => trusted
      }))
      return import('@/lib/services/gallery/galleryAlbumRouteSupport')
    }

    afterEach(() => {
      vi.doUnmock('@/lib/config/trustProxyIpHeaders')
    })

    it('keys a signed-in viewer by their actor, never by address', async () => {
      const { getAlbumReadKey } = await loadWithTrust(true)

      expect(
        getAlbumReadKey(request({ 'x-real-ip': '203.0.113.5' }), {
          id: 'https://llun.test/users/a'
        })
      ).toBe('actor:https://llun.test/users/a')
    })

    it('keys a logged-out viewer by the trusted address', async () => {
      const { getAlbumReadKey } = await loadWithTrust(true)

      expect(
        getAlbumReadKey(request({ 'x-real-ip': '203.0.113.5' }), null)
      ).toBe('ip:203.0.113.5')
    })

    it('has no key for a logged-out viewer when the address is not trusted', async () => {
      const { getAlbumReadKey } = await loadWithTrust(false)

      expect(
        getAlbumReadKey(request({ 'x-real-ip': '203.0.113.5' }), undefined)
      ).toBeNull()
    })
  })

  describe('tryAlbumRead', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('lets a viewer read 300 times a minute and refuses the 301st', async () => {
      const { tryAlbumRead } = await loadSupport()

      for (let hit = 1; hit <= 300; hit += 1) {
        expect(tryAlbumRead('actor:a')).toBeTrue()
      }

      expect(tryAlbumRead('actor:a')).toBeFalse()
      // Another viewer is not slowed by it.
      expect(tryAlbumRead('actor:b')).toBeTrue()
    })

    it('opens a new window after 60 seconds', async () => {
      const { tryAlbumRead } = await loadSupport()
      for (let hit = 0; hit < 300; hit += 1) tryAlbumRead('ip:1.2.3.4')
      expect(tryAlbumRead('ip:1.2.3.4')).toBeFalse()

      vi.advanceTimersByTime(60_000)

      expect(tryAlbumRead('ip:1.2.3.4')).toBeTrue()
    })

    it('does not count reads against writes', async () => {
      const { tryAlbumRead, tryAlbumWrite } = await loadSupport()
      for (let hit = 0; hit < 300; hit += 1) tryAlbumRead('actor:a')

      expect(tryAlbumRead('actor:a')).toBeFalse()
      expect(tryAlbumWrite('actor:a')).toBeTrue()
    })

    it('never limits a read that has no key', async () => {
      const { tryAlbumRead } = await loadSupport()

      for (let hit = 0; hit < 1000; hit += 1) {
        expect(tryAlbumRead(null)).toBeTrue()
      }
    })
  })
})

describe('suggestion read limits', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets an actor read suggestions 20 times a minute and refuses the 21st', async () => {
    const { trySuggestionRead } = await loadSupport()

    for (let hit = 1; hit <= 20; hit += 1) {
      expect(trySuggestionRead('actor')).toBeTrue()
    }

    expect(trySuggestionRead('actor')).toBeFalse()
    expect(trySuggestionRead('quiet actor')).toBeTrue()

    vi.advanceTimersByTime(60_000)
    expect(trySuggestionRead('actor')).toBeTrue()
  })

  it('lets an actor read 120 suggestion photo pages a minute, apart from the suggestions and the writes', async () => {
    const { trySuggestionMediaRead, trySuggestionRead, tryAlbumWrite } =
      await loadSupport()

    for (let hit = 1; hit <= 120; hit += 1) {
      expect(trySuggestionMediaRead('actor')).toBeTrue()
    }

    expect(trySuggestionMediaRead('actor')).toBeFalse()
    // Using up one allowance leaves the others whole.
    expect(trySuggestionRead('actor')).toBeTrue()
    expect(tryAlbumWrite('actor')).toBeTrue()
  })
})

describe('albumRateLimited', () => {
  it('answers 429 with the shared error and the route CORS methods', async () => {
    const { albumRateLimited } = await loadSupport()

    const response = albumRateLimited(
      new NextRequest('https://llun.test/api/v1/gallery/albums', {
        method: 'POST',
        headers: { origin: 'https://llun.test' }
      }),
      [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
    )

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual(ERROR_429)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'POST'
    )
  })
})

describe('readJsonBody', () => {
  const request = (body?: string) =>
    new NextRequest('https://llun.test/api/v1/gallery/albums', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    })

  it('reads a JSON body', async () => {
    const { readJsonBody } = await loadSupport()
    expect(await readJsonBody(request('{"title":"A"}'))).toEqual({
      title: 'A'
    })
  })

  it('gives undefined for no body and for a body that is not JSON', async () => {
    const { readJsonBody } = await loadSupport()
    expect(await readJsonBody(request())).toBeUndefined()
    expect(await readJsonBody(request('not json'))).toBeUndefined()
  })
})
