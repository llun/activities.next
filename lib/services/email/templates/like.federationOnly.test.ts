import { resolveActorEmailBrand } from '@/lib/services/email/sender'
import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { buildLikeEmail } from './like'

const mockConfig = vi.hoisted(() => ({
  host: 'primary.example',
  trustedHosts: ['fed.example', 'alias.example'],
  federationOnlyHosts: ['fed.example'],
  email: { serviceFromAddress: 'no-reply@primary.example' }
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => mockConfig,
  getBaseURL: () => 'https://primary.example',
  buildBaseURL: (host: string) =>
    host.includes('://') ? host : `https://${host}`
}))

const profile = (overrides: Partial<ActorProfile> = {}): ActorProfile => ({
  id: 'https://remote.example.com/users/ben',
  username: 'ben',
  domain: 'remote.example.com',
  name: 'Ben Carter',
  followersUrl: '',
  inboxUrl: '',
  sharedInboxUrl: '',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1000,
  ...overrides
})

const recipientOn = (domain: string): ActorProfile =>
  profile({
    id: `https://${domain}/users/anna`,
    username: 'anna',
    domain,
    name: 'Anna'
  })

const statusOn = (domain: string): EditableStatus =>
  ({
    id: `https://${domain}/statuses/1`,
    url: `https://${domain}/@anna/1`,
    actorId: `https://${domain}/users/anna`,
    actor: recipientOn(domain),
    isLocalActor: true,
    type: StatusType.enum.Note,
    text: 'Morning run done',
    summary: '',
    to: [],
    cc: [],
    tags: [],
    attachments: [],
    replies: [],
    createdAt: 1000
  }) as unknown as EditableStatus

describe('buildLikeEmail with a resolved brand', () => {
  it('links a federation-only recipient email on the primary host', async () => {
    const brand = await resolveActorEmailBrand(null, { domain: 'fed.example' })
    expect(brand.domain).toBe('')

    const email = buildLikeEmail({
      recipient: recipientOn('fed.example'),
      actor: profile(),
      status: statusOn('fed.example'),
      brand
    })

    expect(email.html).toContain('https://primary.example/')
    expect(email.text).toContain('https://primary.example/')
    expect(email.html).not.toContain('https://fed.example/')
    expect(email.text).not.toContain('https://fed.example/')
  })

  it('links a trusted recipient email on that trusted domain', async () => {
    const brand = await resolveActorEmailBrand(null, {
      domain: 'alias.example'
    })
    expect(brand.domain).toBe('alias.example')

    const email = buildLikeEmail({
      recipient: recipientOn('alias.example'),
      actor: profile(),
      status: statusOn('alias.example'),
      brand
    })

    expect(email.html).toContain('https://alias.example/')
    expect(email.text).toContain('https://alias.example/')
    expect(email.html).not.toContain('https://fed.example/')
    expect(email.text).not.toContain('https://fed.example/')
  })
})
