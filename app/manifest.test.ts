import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { VERSION } from '@/lib/utils/version'

import manifest from './manifest'

// The manifest is fetched from whichever domain the app is installed from.
vi.mock('@/lib/services/domains/domainIdentity', () => ({
  getVisitedDomainIdentity: vi.fn()
}))

const anIdentity = (domain: string, name: string) => ({
  domain,
  source: 'database' as const,
  name,
  description: '',
  contactEmail: '',
  termsOfService: null,
  privacyPolicy: null,
  disabledFeatures: []
})

describe('manifest', () => {
  beforeEach(() => {
    vi.mocked(getVisitedDomainIdentity).mockReset()
    vi.mocked(getVisitedDomainIdentity).mockResolvedValue(
      anIdentity('test.llun.dev', 'Activities.next')
    )
  })

  it('exports versioned app icons to invalidate caches', async () => {
    const m = await manifest()
    expect(m.start_url).toBe('/app')
    expect(m.scope).toBe('/')
    const v = encodeURIComponent(VERSION)
    expect(m.icons).toEqual([
      {
        src: `/icon-192.png?v=${v}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: `/icon-512.png?v=${v}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: `/icon-maskable-192.png?v=${v}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable'
      },
      {
        src: `/icon-maskable-512.png?v=${v}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ])
  })

  it('keeps the static light colours the install prompt reads', async () => {
    const m = await manifest()

    expect(m.background_color).toBe('#ffffff')
    expect(m.theme_color).toBe('#ffffff')
  })

  it('registers the share target the service worker answers', async () => {
    const m = await manifest()

    expect(m.share_target).toEqual({
      action: '/_share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [
          {
            name: 'files',
            accept: [
              'image/*',
              'video/*',
              '.fit',
              '.gpx',
              '.tcx',
              'application/vnd.ant.fit',
              'application/gpx+xml',
              'application/vnd.garmin.tcx+xml',
              'application/octet-stream'
            ]
          }
        ]
      }
    })
  })

  it('offers shortcuts to the composer, the fitness import and the gallery', async () => {
    const m = await manifest()
    const v = encodeURIComponent(VERSION)

    expect(m.shortcuts?.map((shortcut) => shortcut.url)).toEqual([
      '/app',
      '/fitness/files',
      '/gallery'
    ])
    for (const shortcut of m.shortcuts ?? []) {
      expect(shortcut.icons).toEqual([
        {
          src: `/icon-192.png?v=${v}`,
          sizes: '192x192',
          type: 'image/png'
        }
      ])
    }
  })

  it.each([
    {
      description: 'the primary',
      identity: anIdentity('test.llun.dev', 'Activities.next'),
      expected: 'Activities.next'
    },
    {
      description: 'a served domain with its own name',
      identity: anIdentity('run.example', 'Run Club'),
      expected: 'Run Club'
    },
    {
      description: 'a domain with a blank name, after the domain',
      identity: anIdentity('run.example', ''),
      expected: 'run.example'
    }
  ])('names the app after $description', async ({ identity, expected }) => {
    vi.mocked(getVisitedDomainIdentity).mockResolvedValue(identity)

    const m = await manifest()

    expect(m.name).toBe(expected)
    expect(m.short_name).toBe(expected)
  })
})
