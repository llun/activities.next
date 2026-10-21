import type { DomainIdentity } from '@/lib/services/domains/domainIdentity'

import { getAddressFromEmail } from './address'
import { getEmailSender, resolveActorEmailBrand } from './sender'

const mockConfig = vi.hoisted(() => ({
  host: 'primary.example',
  email: { serviceFromAddress: '"Primary" <no-reply@primary.example>' }
}))
vi.mock('@/lib/config', () => ({ getConfig: () => mockConfig }))

const mockResolve = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/domains/domainIdentity', () => ({
  resolveDomainIdentity: mockResolve
}))

const mockServedLinkDomain = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/domains/localDomains', () => ({
  getServedLinkDomain: mockServedLinkDomain
}))

const identity = (overrides: Partial<DomainIdentity>): DomainIdentity => ({
  domain: 'acme.example',
  source: 'database',
  name: 'Acme',
  description: '',
  contactEmail: '',
  termsOfService: null,
  privacyPolicy: null,
  ...overrides
})

describe('getEmailSender', () => {
  beforeEach(() => {
    mockConfig.email.serviceFromAddress = '"Primary" <no-reply@primary.example>'
  })

  it('keeps ACTIVITIES_EMAIL_FROM unchanged for the primary domain', () => {
    expect(
      getEmailSender(
        identity({ domain: 'primary.example', source: 'primary', name: 'X' })
      )
    ).toBe('"Primary" <no-reply@primary.example>')
  })

  it('sends other domains under their name from the bare address', () => {
    expect(getEmailSender(identity({}))).toEqual({
      name: 'Acme',
      email: 'no-reply@primary.example'
    })
  })

  it('takes the address out of an unquoted Name <address> and a bare address', () => {
    mockConfig.email.serviceFromAddress = 'Mailer <mail@primary.example>'
    expect(getEmailSender(identity({}))).toMatchObject({
      email: 'mail@primary.example'
    })
    mockConfig.email.serviceFromAddress = 'mail@primary.example'
    expect(getEmailSender(identity({}))).toMatchObject({
      email: 'mail@primary.example'
    })
  })

  it('sends the bare address when the name is blank', () => {
    expect(getEmailSender(identity({ name: '  ' }))).toBe(
      'no-reply@primary.example'
    )
  })
})

describe('getAddressFromEmail', () => {
  it('writes a string as is', () => {
    expect(getAddressFromEmail('a@b.c')).toBe('a@b.c')
  })

  it('quotes the name', () => {
    expect(getAddressFromEmail({ name: 'Acme', email: 'a@b.c' })).toBe(
      '"Acme" <a@b.c>'
    )
  })

  it('strips CR, LF, quotes and backslashes from the name', () => {
    expect(
      getAddressFromEmail({
        name: 'Evil"\r\nBcc: x@y.z\\',
        email: 'a@b.c'
      })
    ).toBe('"EvilBcc: x@y.z" <a@b.c>')
  })

  it('drops a name that is empty after sanitising', () => {
    expect(getAddressFromEmail({ name: '"\r\n', email: 'a@b.c' })).toBe('a@b.c')
  })
})

describe('resolveActorEmailBrand', () => {
  it('resolves the identity of the actor’s served domain', async () => {
    mockServedLinkDomain.mockReturnValue('acme.example')
    mockResolve.mockResolvedValue(identity({}))
    await expect(
      resolveActorEmailBrand(null, { domain: 'acme.example' })
    ).resolves.toEqual({ name: 'Acme', domain: 'acme.example' })
    expect(mockResolve).toHaveBeenCalledWith(null, 'acme.example')
  })

  it('falls back to the primary when the domain is not served', async () => {
    mockServedLinkDomain.mockReturnValue(null)
    mockResolve.mockResolvedValue(
      identity({ domain: 'primary.example', source: 'primary', name: 'Main' })
    )
    await expect(
      resolveActorEmailBrand(null, { domain: 'other.example' })
    ).resolves.toEqual({ name: 'Main', domain: 'primary.example' })
    expect(mockResolve).toHaveBeenLastCalledWith(null, null)
  })
})
