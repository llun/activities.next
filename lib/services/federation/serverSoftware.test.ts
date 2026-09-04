import { enableFetchMocks } from 'jest-fetch-mock'

import { MockActivityPubPerson } from '@/lib/stub/person'
import { Actor } from '@/lib/types/activitypub'

import {
  FAILURE_TTL_MS,
  MAX_CACHED_DOMAINS,
  SUCCESS_TTL_MS,
  clearServerSoftwareCache,
  getServerSoftware,
  getServerSoftwareCacheSizeForTests,
  getServerSoftwareInfo,
  isMediaOnlyActor,
  isMediaOnlyDomain,
  isMisskeyActor,
  isMisskeyDomain,
  isPeerTubeActor,
  isPeerTubeDomain,
  isPixelfedActor,
  isPixelfedDomain
} from './serverSoftware'

const requestedUrls = () =>
  fetchMock.mock.calls.map((call) => {
    const [input] = call
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.toString()
    return (input as Request).url
  })

enableFetchMocks()

describe('serverSoftware', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    clearServerSoftwareCache()
  })

  it('detects Pixelfed instances via NodeInfo', async () => {
    const domain = 'pixelfed.example'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${domain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${domain}/api/nodeinfo/2.0.json`
              }
            ]
          })
        }
      }
      if (req.url === `https://${domain}/api/nodeinfo/2.0.json`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'Pixelfed',
              version: '0.12.9'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const software = await getServerSoftware(domain)
    expect(software).toBe('pixelfed')

    const softwareInfo = await getServerSoftwareInfo(domain)
    expect(softwareInfo).toEqual({
      name: 'pixelfed',
      version: '0.12.9'
    })

    const isPixelfed = await isPixelfedDomain(domain)
    expect(isPixelfed).toBe(true)

    const person = MockActivityPubPerson({
      id: `https://${domain}/users/dansup`
    }) as Actor
    expect(await isPixelfedActor(person)).toBe(true)
  })

  it('detects PeerTube instances via NodeInfo', async () => {
    const domain = 'peertube.example'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${domain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${domain}/nodeinfo/2.0.json`
              }
            ]
          })
        }
      }
      if (req.url === `https://${domain}/nodeinfo/2.0.json`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'peertube',
              version: '8.2.4'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const software = await getServerSoftware(domain)
    expect(software).toBe('peertube')

    const isPeerTube = await isPeerTubeDomain(domain)
    expect(isPeerTube).toBe(true)

    const person = MockActivityPubPerson({
      id: `https://${domain}/accounts/framasoft`
    }) as Actor
    expect(await isPeerTubeActor(person)).toBe(true)
  })

  it('returns false for Mastodon or other non-Pixelfed instances', async () => {
    const domain = 'mastodon.example'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${domain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${domain}/nodeinfo/2.0`
              }
            ]
          })
        }
      }
      if (req.url === `https://${domain}/nodeinfo/2.0`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'mastodon',
              version: '4.3.0'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const softwareInfo = await getServerSoftwareInfo(domain)
    expect(softwareInfo).toEqual({
      name: 'mastodon',
      version: '4.3.0'
    })

    const isPixelfed = await isPixelfedDomain(domain)
    expect(isPixelfed).toBe(false)
  })

  it('handles server software without a version', async () => {
    const domain = 'noversion.example'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${domain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${domain}/nodeinfo/2.0`
              }
            ]
          })
        }
      }
      if (req.url === `https://${domain}/nodeinfo/2.0`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'pleroma'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const softwareInfo = await getServerSoftwareInfo(domain)
    expect(softwareInfo).toEqual({
      name: 'pleroma',
      version: null
    })
  })

  it('handles 404 on NodeInfo gracefully and caches negative result', async () => {
    const domain = 'unreachable.example'
    fetchMock.mockResponse(async () => ({
      status: 404,
      body: 'Not Found'
    }))

    const isPixelfedFirst = await isPixelfedDomain(domain)
    expect(isPixelfedFirst).toBe(false)

    // Second call should return cached false without calling fetch again
    fetchMock.resetMocks()
    const isPixelfedSecond = await isPixelfedDomain(domain)
    expect(isPixelfedSecond).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns false for malformed person ID', async () => {
    const person = { id: 'invalid-url' } as Actor
    expect(await isPixelfedActor(person)).toBe(false)
  })

  it('re-probes after a failed lookup expires (FAILURE_TTL_MS)', async () => {
    vi.useFakeTimers()
    try {
      const domain = 'transient.example'
      fetchMock.mockResponse(async () => ({ status: 404, body: 'Not Found' }))

      expect(await getServerSoftware(domain)).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // A failure is a cache HIT until it expires — no second fetch.
      expect(await getServerSoftware(domain)).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(FAILURE_TTL_MS + 1)
      expect(await getServerSoftware(domain)).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-probes after a successful lookup expires (SUCCESS_TTL_MS)', async () => {
    vi.useFakeTimers()
    try {
      const domain = 'pixelfed.example'
      let wellKnownFetches = 0
      fetchMock.mockResponse(async (req) => {
        if (req.url === `https://${domain}/.well-known/nodeinfo`) {
          wellKnownFetches += 1
          return {
            status: 200,
            body: JSON.stringify({
              links: [
                {
                  rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                  href: `https://${domain}/api/nodeinfo/2.0.json`
                }
              ]
            })
          }
        }
        if (req.url === `https://${domain}/api/nodeinfo/2.0.json`) {
          return {
            status: 200,
            body: JSON.stringify({ software: { name: 'Pixelfed' } })
          }
        }
        return { status: 404, body: 'Not Found' }
      })

      expect(await getServerSoftware(domain)).toBe('pixelfed')
      expect(wellKnownFetches).toBe(1)

      // Cached within the success window.
      expect(await getServerSoftware(domain)).toBe('pixelfed')
      expect(wellKnownFetches).toBe(1)

      vi.advanceTimersByTime(SUCCESS_TTL_MS + 1)
      expect(await getServerSoftware(domain)).toBe('pixelfed')
      expect(wellKnownFetches).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a NodeInfo href on a different host', async () => {
    const domain = 'victim.example'
    const evilUrl = 'https://evil.example/nodeinfo/2.0'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${domain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: evilUrl
              }
            ]
          })
        }
      }
      // Would report pixelfed IF the cross-host href were ever followed.
      return {
        status: 200,
        body: JSON.stringify({ software: { name: 'pixelfed' } })
      }
    })

    expect(await isPixelfedDomain(domain)).toBe(false)
    expect(requestedUrls()).not.toContain(evilUrl)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a rel-less first link on a different host', async () => {
    const domain = 'victim2.example'
    const evilUrl = 'https://evil.example/nodeinfo'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${domain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({ links: [{ href: evilUrl }] })
        }
      }
      return {
        status: 200,
        body: JSON.stringify({ software: { name: 'pixelfed' } })
      }
    })

    expect(await isPixelfedDomain(domain)).toBe(false)
    expect(requestedUrls()).not.toContain(evilUrl)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still follows a rel-less first link on the same host (compatibility fallback preserved)', async () => {
    const domain = 'norel.example'
    const infoUrl = `https://${domain}/nodeinfo/2.0`
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${domain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({ links: [{ href: infoUrl }] })
        }
      }
      if (req.url === infoUrl) {
        return {
          status: 200,
          body: JSON.stringify({ software: { name: 'Pixelfed' } })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    expect(await getServerSoftware(domain)).toBe('pixelfed')
  })

  it('evicts the oldest entry past MAX_CACHED_DOMAINS', async () => {
    fetchMock.mockResponse(async () => ({ status: 404, body: 'Not Found' }))

    for (let index = 0; index < MAX_CACHED_DOMAINS + 10; index += 1) {
      await getServerSoftware(`d${index}.example`)
    }

    expect(getServerSoftwareCacheSizeForTests()).toBe(MAX_CACHED_DOMAINS)
  })

  it('detects Misskey and fork instances via NodeInfo', async () => {
    const domain = 'misskey.example'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${domain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${domain}/nodeinfo/2.0`
              }
            ]
          })
        }
      }
      if (req.url === `https://${domain}/nodeinfo/2.0`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'Misskey',
              version: '2025.4.1'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    expect(await isMisskeyDomain(domain)).toBe(true)
    const person = MockActivityPubPerson({
      id: `https://${domain}/users/7rkrarq81i`
    }) as Actor
    expect(await isMisskeyActor(person)).toBe(true)
  })

  it('detects Sharkey and Firefish as Misskey family', async () => {
    const sharkeyDomain = 'sharkey.example'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${sharkeyDomain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${sharkeyDomain}/nodeinfo/2.0`
              }
            ]
          })
        }
      }
      if (req.url === `https://${sharkeyDomain}/nodeinfo/2.0`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'sharkey',
              version: '2024.1.0'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    expect(await isMisskeyDomain(sharkeyDomain)).toBe(true)
  })

  it('returns false for non-Misskey software in isMisskeyDomain', async () => {
    const mastodonDomain = 'mastodon.example'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${mastodonDomain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${mastodonDomain}/nodeinfo/2.0`
              }
            ]
          })
        }
      }
      if (req.url === `https://${mastodonDomain}/nodeinfo/2.0`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'mastodon',
              version: '4.3.0'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    expect(await isMisskeyDomain(mastodonDomain)).toBe(false)
  })

  it('detects PeerTube instances correctly with isPeerTubeDomain and isPeerTubeActor', async () => {
    const peertubeDomain = 'framatube.org'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${peertubeDomain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${peertubeDomain}/nodeinfo/2.0`
              }
            ]
          })
        }
      }
      if (req.url === `https://${peertubeDomain}/nodeinfo/2.0`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'peertube',
              version: '6.0.0'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    expect(await isPeerTubeDomain(peertubeDomain)).toBe(true)
    const person = MockActivityPubPerson({
      id: `https://${peertubeDomain}/accounts/framasoft`
    }) as Actor
    expect(await isPeerTubeActor(person)).toBe(true)
    expect(await isMediaOnlyDomain(peertubeDomain)).toBe(true)
    expect(await isMediaOnlyActor(person)).toBe(true)
  })

  it('detects Pixelfed instances as media-only with isMediaOnlyDomain and isMediaOnlyActor', async () => {
    const pixelfedDomain = 'pixelfed.social'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${pixelfedDomain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${pixelfedDomain}/nodeinfo/2.0`
              }
            ]
          })
        }
      }
      if (req.url === `https://${pixelfedDomain}/nodeinfo/2.0`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'pixelfed',
              version: '0.12.9'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    expect(await isMediaOnlyDomain(pixelfedDomain)).toBe(true)
    const person = MockActivityPubPerson({
      id: `https://${pixelfedDomain}/users/gargron`
    }) as Actor
    expect(await isMediaOnlyActor(person)).toBe(true)
  })

  it('returns false for general microblogging platforms in isMediaOnlyDomain', async () => {
    const mastodonDomain = 'mastodon.social'
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://${mastodonDomain}/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: `https://${mastodonDomain}/nodeinfo/2.0`
              }
            ]
          })
        }
      }
      if (req.url === `https://${mastodonDomain}/nodeinfo/2.0`) {
        return {
          status: 200,
          body: JSON.stringify({
            software: {
              name: 'mastodon',
              version: '4.3.0'
            }
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    expect(await isPeerTubeDomain(mastodonDomain)).toBe(false)
    expect(await isMediaOnlyDomain(mastodonDomain)).toBe(false)
  })
})
