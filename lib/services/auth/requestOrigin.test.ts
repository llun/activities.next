import { ACTIVITIES_HOST, FORWARDED_HOST } from '@/lib/constants'

import { resolveAuthBaseURL } from './requestOrigin'

const config = {
  host: 'activities.example',
  trustedHosts: ['alias.example', 'second.example']
}

describe('resolveAuthBaseURL', () => {
  it('uses the configured host when no host headers are present', () => {
    expect(resolveAuthBaseURL(new Headers(), config)).toBe(
      'https://activities.example'
    )
  })

  it('uses a trusted forwarded host so its passkeys are used', () => {
    const headers = new Headers({ [FORWARDED_HOST]: 'alias.example' })
    expect(resolveAuthBaseURL(headers, config)).toBe('https://alias.example')
  })

  it('prefers the activities-next host header over forwarded/host', () => {
    const headers = new Headers({
      [ACTIVITIES_HOST]: 'second.example',
      [FORWARDED_HOST]: 'alias.example',
      host: 'activities.example'
    })
    expect(resolveAuthBaseURL(headers, config)).toBe('https://second.example')
  })

  it('falls back to the configured host for an untrusted host header', () => {
    const headers = new Headers({ [FORWARDED_HOST]: 'evil.example' })
    expect(resolveAuthBaseURL(headers, config)).toBe(
      'https://activities.example'
    )
  })

  it('treats a missing trustedHosts list as no extra trusted hosts', () => {
    const headers = new Headers({ [FORWARDED_HOST]: 'alias.example' })
    expect(resolveAuthBaseURL(headers, { host: 'activities.example' })).toBe(
      'https://activities.example'
    )
  })
})
