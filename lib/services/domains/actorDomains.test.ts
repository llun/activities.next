import {
  getActorDomainChoices,
  getActorDomainRules,
  resolveActorDomain
} from './actorDomains'

describe('actorDomains', () => {
  const config = { host: 'llun.test', trustedHosts: ['*.preview.test'] }

  it('uses only the concrete allowActorDomains entries', () => {
    expect(
      getActorDomainRules(config, ['allowed.test', '*.example.org'])
    ).toEqual(['allowed.test'])
  })

  it('does not approve a subdomain of an allowActorDomains wildcard', () => {
    const rules = getActorDomainRules(config, ['*.example.org'])
    expect(resolveActorDomain('social.example.org', rules)).toBeNull()
    expect(resolveActorDomain('*.example.org', rules)).toBeNull()
  })

  it('approves nothing, and does not fall back, for a wildcard-only list', () => {
    expect(getActorDomainRules(config, ['*.example.org'])).toEqual([])
    expect(
      resolveActorDomain('llun.test', getActorDomainRules(config, ['*.x.test']))
    ).toBeNull()
  })

  it('falls back to the served domain rules when the list is empty', () => {
    expect(getActorDomainRules(config, [])).toEqual(['llun.test'])
  })

  it('never lists a wildcard or a host only a wildcard covers', () => {
    expect(
      getActorDomainChoices(['a.test', '*.example.org'], 'social.example.org')
    ).toEqual(['a.test'])
    expect(getActorDomainChoices(['a.test'], 'A.test')).toEqual(['a.test'])
  })
})
