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
        type: 'image/png'
      },
      {
        src: `/icon-512.png?v=${v}`,
        sizes: '512x512',
        type: 'image/png'
      }
    ])
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
