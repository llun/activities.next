import {
  announcementsDomainOf,
  rulesDomainOf
} from '@/lib/services/domains/domainAudience'
import type { DomainIdentity } from '@/lib/services/domains/domainIdentity'

const identity = (source: DomainIdentity['source']): DomainIdentity => ({
  domain: 'club.example',
  source,
  name: 'Club',
  description: '',
  contactEmail: '',
  termsOfService: null,
  privacyPolicy: null,
  disabledFeatures: []
})

describe('rulesDomainOf', () => {
  it('has own rules for an env domain and an active added one only', () => {
    expect(rulesDomainOf(identity('env'))).toBe('club.example')
    expect(rulesDomainOf(identity('database'))).toBe('club.example')
    // The primary's rules are the server rules; a wildcard host is a preview.
    expect(rulesDomainOf(identity('primary'))).toBeNull()
    expect(rulesDomainOf(identity('other'))).toBeNull()
  })
})

describe('announcementsDomainOf', () => {
  it('adds the visited domain’s announcements, the primary’s included', () => {
    expect(announcementsDomainOf(identity('primary'))).toBe('club.example')
    expect(announcementsDomainOf(identity('env'))).toBe('club.example')
    expect(announcementsDomainOf(identity('database'))).toBe('club.example')
    expect(announcementsDomainOf(identity('other'))).toBeNull()
  })
})
