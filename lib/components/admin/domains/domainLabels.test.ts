import type { AdminDomain } from '@/lib/services/domains/adminDomainTypes'

import {
  domainSettingsHref,
  getDomainCheckBadge,
  getDomainCheckItemDetail,
  getDomainStatusBadge,
  getSignupsBadge
} from './domainLabels'

const base: AdminDomain = {
  domain: 'run.example',
  source: 'database',
  name: null,
  status: 'off',
  profiles: 0,
  signupsOpen: false,
  allowedEmails: [],
  allowExistingUsers: false,
  lastCheckedAt: null,
  lastCheck: null
}

const failedCheck = {
  passed: false,
  reason: 'dns' as const,
  items: [
    { key: 'dns' as const, status: 'failed' as const },
    { key: 'tls' as const, status: 'skipped' as const },
    { key: 'host' as const, status: 'skipped' as const }
  ]
}

describe('domainLabels', () => {
  it('encodes a domain with a port in its settings link', () => {
    expect(domainSettingsHref('run.example:8443')).toBe(
      '/admin/domains/run.example%3A8443'
    )
  })

  it.each([
    [{ source: 'env' as const }, 'On'],
    [{ source: 'primary' as const }, 'On'],
    [{}, 'Off'],
    [{ status: 'on' as const }, 'Reachable'],
    [{ status: 'on' as const, lastCheck: failedCheck }, 'Not reachable'],
    [{ lastCheck: failedCheck }, 'Not reachable']
  ])('status %j reads %s', (overrides, label) => {
    expect(getDomainStatusBadge({ ...base, ...overrides }).label).toBe(label)
  })

  it('has no check badge for env domains, and Not checked before a check', () => {
    expect(getDomainCheckBadge({ ...base, source: 'env' })).toBeNull()
    expect(getDomainCheckBadge(base)?.label).toBe('Not checked')
  })

  it.each([
    [{ signupsOpen: false }, 'Closed'],
    [{ signupsOpen: true }, 'Open'],
    [{ signupsOpen: true, allowedEmails: ['a@x.example'] }, 'Open to 1 email'],
    [
      { signupsOpen: true, allowedEmails: ['a@x.example', 'b@x.example'] },
      'Open to 2 emails'
    ]
  ])('sign-ups %j read %s', (overrides, label) => {
    expect(getSignupsBadge({ ...base, ...overrides }).label).toBe(label)
  })

  it('words each failure for what to fix', () => {
    expect(
      getDomainCheckItemDetail(
        'run.example',
        { key: 'dns', status: 'failed' },
        'private-address'
      )
    ).toContain('private address')
    expect(
      getDomainCheckItemDetail(
        'run.example',
        { key: 'host', status: 'failed' },
        'host-header'
      )
    ).toContain('Keep the original Host header')
    expect(
      getDomainCheckItemDetail(
        'run.example',
        { key: 'tls', status: 'skipped' },
        'unreachable'
      )
    ).toContain('Nothing answered on https://run.example')
  })
})
