import type { DomainIdentity } from '@/lib/services/domains/domainIdentity'

import { getAddressFromEmail } from './address'
import { getEmailSender, resolveActorEmailBrand, toEmailBrand } from './sender'

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

  it('falls back to the domain when the name is blank', () => {
    expect(getEmailSender(identity({ name: '  ' }))).toEqual({
      name: 'acme.example',
      email: 'no-reply@primary.example'
    })
    expect(toEmailBrand(identity({ name: '' })).name).toBe('acme.example')
  })

  it('treats a wildcard preview host (source other) as the primary', () => {
    const preview = identity({
      domain: 'pr-1.preview.example',
      source: 'other',
      name: 'Server'
    })
    expect(getEmailSender(preview)).toBe('"Primary" <no-reply@primary.example>')
    expect(toEmailBrand(preview)).toEqual({ name: 'Server', domain: '' })
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

  it('removes quotes and backslashes and turns CR and LF into spaces', () => {
    expect(
      getAddressFromEmail({
        name: 'Evil"\r\nBcc: x@y.z\\',
        email: 'a@b.c'
      })
    ).toBe('"Evil Bcc: x@y.z" <a@b.c>')
  })

  it('turns other control characters and line separators into spaces', () => {
    expect(
      getAddressFromEmail({
        name: 'A\u0000B\u000bC\u001bD\u0085E\u2028F\u2029G  H',
        email: 'a@b.c'
      })
    ).toBe('"A B C D E F G H" <a@b.c>')
  })

  it('leaves a non-ASCII name raw unless encoding is asked for', () => {
    expect(getAddressFromEmail({ name: 'Café Run', email: 'a@b.c' })).toBe(
      '"Café Run" <a@b.c>'
    )
  })

  it('encodes a non-ASCII name as an RFC 2047 encoded-word', () => {
    const base64 = Buffer.from('Café Run').toString('base64')
    expect(
      getAddressFromEmail(
        { name: 'Café Run', email: 'a@b.c' },
        { encodeName: true }
      )
    ).toBe(`=?UTF-8?B?${base64}?= <a@b.c>`)
  })

  it('keeps an ASCII name quoted when encoding is asked for', () => {
    expect(
      getAddressFromEmail(
        { name: 'Acme', email: 'a@b.c' },
        { encodeName: true }
      )
    ).toBe('"Acme" <a@b.c>')
  })

  it('splits a long non-ASCII name into encoded-words of at most 75 characters', () => {
    const name = 'ランニングクラブ'.repeat(6)
    const header = getAddressFromEmail(
      { name, email: 'a@b.c' },
      { encodeName: true }
    )
    const words = header.replace(/ <a@b\.c>$/, '').split(' ')
    expect(words.length).toBeGreaterThan(1)
    for (const word of words) {
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
      expect(word.length).toBeLessThanOrEqual(75)
    }
    const decoded = words
      .map((word) => Buffer.from(word.slice(10, -2), 'base64').toString('utf8'))
      .join('')
    expect(decoded).toBe(name)
  })

  it('cannot inject a header through an encoded name', () => {
    const header = getAddressFromEmail(
      { name: 'é\r\nBcc: x@y.z', email: 'a@b.c' },
      { encodeName: true }
    )
    expect(header).not.toMatch(/[\r\n]/)
    expect(header).toMatch(/^=\?UTF-8\?B\?/)
  })

  it('drops a name that is empty after sanitising', () => {
    expect(getAddressFromEmail({ name: '"\r\n', email: 'a@b.c' })).toBe('a@b.c')
  })
})

describe('toEmailBrand', () => {
  it('leaves the domain empty for the primary so links stay on getBaseURL()', () => {
    expect(
      toEmailBrand(identity({ source: 'primary', domain: 'primary.example' }))
    ).toEqual({ name: 'Acme', domain: '' })
  })

  it('names the domain of any other identity', () => {
    expect(toEmailBrand(identity({}))).toEqual({
      name: 'Acme',
      domain: 'acme.example'
    })
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
    ).resolves.toEqual({ name: 'Main', domain: '' })
    expect(mockResolve).toHaveBeenLastCalledWith(null, null)
  })
})
