import {
  DEFAULT_EMAIL_INBOUND_LOCAL_PART_PREFIX,
  getEmailInboundConfig
} from './emailInbound'

describe('getEmailInboundConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ACTIVITIES_EMAIL_INBOUND_SECRET
    delete process.env.ACTIVITIES_EMAIL_INBOUND_DOMAIN
    delete process.env.ACTIVITIES_EMAIL_INBOUND_LOCAL_PART_PREFIX
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns null when no inbound email env vars are set', () => {
    expect(getEmailInboundConfig()).toBeNull()
  })

  it('returns the secret, domain and the default local part prefix', () => {
    process.env.ACTIVITIES_EMAIL_INBOUND_SECRET = 'inbound-secret'
    process.env.ACTIVITIES_EMAIL_INBOUND_DOMAIN = 'reply.example.tld'

    expect(getEmailInboundConfig()).toEqual({
      emailInbound: {
        secret: 'inbound-secret',
        domain: 'reply.example.tld',
        localPartPrefix: DEFAULT_EMAIL_INBOUND_LOCAL_PART_PREFIX
      }
    })
  })

  it('uses a configured local part prefix', () => {
    process.env.ACTIVITIES_EMAIL_INBOUND_SECRET = 'inbound-secret'
    process.env.ACTIVITIES_EMAIL_INBOUND_DOMAIN = 'reply.example.tld'
    process.env.ACTIVITIES_EMAIL_INBOUND_LOCAL_PART_PREFIX = 'post'

    expect(getEmailInboundConfig()?.emailInbound.localPartPrefix).toBe('post')
  })

  it.each([
    { description: 'a prefix containing an @', prefix: 'reply@x' },
    { description: 'a prefix containing a space', prefix: 'in box' },
    { description: 'a prefix containing a plus', prefix: 'reply+extra' }
  ])('falls back to the default prefix for $description', ({ prefix }) => {
    process.env.ACTIVITIES_EMAIL_INBOUND_SECRET = 'inbound-secret'
    process.env.ACTIVITIES_EMAIL_INBOUND_DOMAIN = 'reply.example.tld'
    process.env.ACTIVITIES_EMAIL_INBOUND_LOCAL_PART_PREFIX = prefix

    expect(getEmailInboundConfig()?.emailInbound.localPartPrefix).toBe(
      DEFAULT_EMAIL_INBOUND_LOCAL_PART_PREFIX
    )
  })

  it.each([
    {
      description: 'the secret is missing',
      secret: undefined,
      domain: 'reply.example.tld'
    },
    {
      description: 'the domain is missing',
      secret: 'inbound-secret',
      domain: undefined
    },
    {
      description: 'the domain carries a scheme',
      secret: 'inbound-secret',
      domain: 'https://reply.example.tld'
    },
    {
      description: 'the domain is a full address',
      secret: 'inbound-secret',
      domain: 'reply@example.tld'
    },
    {
      description: 'the domain has no dot',
      secret: 'inbound-secret',
      domain: 'localhost'
    }
  ])('disables the feature when $description', ({ secret, domain }) => {
    // A partially-configured prefix still trips the matcher, so the reader is
    // reached and has to reject rather than half-enable the feature.
    process.env.ACTIVITIES_EMAIL_INBOUND_LOCAL_PART_PREFIX = 'reply'
    if (secret) process.env.ACTIVITIES_EMAIL_INBOUND_SECRET = secret
    if (domain) process.env.ACTIVITIES_EMAIL_INBOUND_DOMAIN = domain

    expect(getEmailInboundConfig()).toBeNull()
  })
})
