import { enableFetchMocks } from 'jest-fetch-mock'

import { MockActivityPubPerson } from '@/lib/stub/person'
import { Actor } from '@/lib/types/activitypub'

import {
  clearServerSoftwareCache,
  getServerSoftware,
  isPixelfedActor,
  isPixelfedDomain
} from './serverSoftware'

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

    const isPixelfed = await isPixelfedDomain(domain)
    expect(isPixelfed).toBe(true)

    const person = MockActivityPubPerson({
      id: `https://${domain}/users/dansup`
    }) as Actor
    expect(await isPixelfedActor(person)).toBe(true)
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

    const isPixelfed = await isPixelfedDomain(domain)
    expect(isPixelfed).toBe(false)
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
})
