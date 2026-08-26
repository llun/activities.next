import { ensureDomainListed, getServedDomains } from './servedDomains'

describe('getServedDomains', () => {
  it('returns just the primary host when there are no trusted hosts', () => {
    expect(getServedDomains({ host: 'llun.social' })).toEqual([
      { domain: 'llun.social', primary: true }
    ])
  })

  // A passkey binds to one concrete domain, so any wildcard is disqualifying —
  // and the parser is what MAKES the `*` in the encoded spellings, so the
  // check has to read the PARSED hostname. A raw check let `%2aevil.example`
  // through as the concrete-looking domain `*evil.example`.
  it.each([
    { description: 'a documented wildcard', host: '*.wild.example' },
    { description: 'a misplaced wildcard', host: '*evil.example' },
    { description: 'a percent-encoded asterisk', host: '%2aevil.example' },
    { description: 'a fullwidth asterisk', host: '＊evil.example' }
  ])('omits a trusted host spelled as $description', ({ host }) => {
    expect(
      getServedDomains({
        host: 'llun.social',
        trustedHosts: [host, 'ok.example']
      })
    ).toEqual([
      { domain: 'llun.social', primary: true },
      { domain: 'ok.example', primary: false }
    ])
  })

  it('lists the primary first, then trusted hosts', () => {
    expect(
      getServedDomains({
        host: 'llun.social',
        trustedHosts: ['social.llun.dev', 'llun.photos']
      })
    ).toEqual([
      { domain: 'llun.social', primary: true },
      { domain: 'social.llun.dev', primary: false },
      { domain: 'llun.photos', primary: false }
    ])
  })

  it('strips scheme and port and de-duplicates the primary host', () => {
    expect(
      getServedDomains({
        host: 'https://llun.social',
        trustedHosts: ['llun.social:443', 'https://llun.photos/']
      })
    ).toEqual([
      { domain: 'llun.social', primary: true },
      { domain: 'llun.photos', primary: false }
    ])
  })

  it('skips wildcard and unparseable trusted-host entries', () => {
    expect(
      getServedDomains({
        host: 'llun.social',
        trustedHosts: ['*.llun.dev', '   ', 'llun.photos']
      })
    ).toEqual([
      { domain: 'llun.social', primary: true },
      { domain: 'llun.photos', primary: false }
    ])
  })
})

describe('ensureDomainListed', () => {
  const domains = [
    { domain: 'llun.social', primary: true },
    { domain: 'llun.photos', primary: false }
  ]

  it('returns the list unchanged when the domain is already present', () => {
    expect(ensureDomainListed(domains, 'llun.photos')).toBe(domains)
  })

  it('appends a wildcard-matched current host that is not listed', () => {
    expect(ensureDomainListed(domains, 'foo.llun.dev')).toEqual([
      ...domains,
      { domain: 'foo.llun.dev', primary: false }
    ])
  })

  it('returns the list unchanged for an empty domain', () => {
    expect(ensureDomainListed(domains, '')).toBe(domains)
  })
})
