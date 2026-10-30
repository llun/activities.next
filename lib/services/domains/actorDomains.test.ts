import { getActorDomainRules, resolveActorDomain } from './actorDomains'

describe('actorDomains', () => {
  const config = { host: 'llun.test', trustedHosts: ['*.preview.test'] }

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
})
