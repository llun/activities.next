import { ActorProfile } from '@/lib/types/domain/actor'

import { buildGearServiceDueEmail } from './gearServiceDue'

// No local vi.mock of '@/lib/config': the global mock in vitest.setup.ts
// supplies both getConfig and getBaseURL, and a partial local factory would
// make the shared layout fail with "getBaseURL is not a function".
const HOST = 'test.llun.dev'

const actor: ActorProfile = {
  id: `https://${HOST}/users/testuser`,
  username: 'testuser',
  domain: HOST,
  followersUrl: `https://${HOST}/users/testuser/followers`,
  inboxUrl: `https://${HOST}/users/testuser/inbox`,
  sharedInboxUrl: `https://${HOST}/inbox`,
  followingCount: 10,
  followersCount: 20,
  statusCount: 5,
  lastStatusAt: 1000,
  createdAt: 1000
}

const buildComponentEmail = () =>
  buildGearServiceDueEmail({
    recipient: actor,
    gearId: 'gear-moots',
    gearName: 'Moots',
    componentName: 'Chain',
    totalDistanceMeters: 5_120_000,
    thresholdMeters: 5_000_000
  })

const buildShoesEmail = () =>
  buildGearServiceDueEmail({
    recipient: actor,
    gearId: 'gear-cloud',
    gearName: 'On Cloud Waterproof',
    totalDistanceMeters: 662_400,
    thresholdMeters: 650_000
  })

describe('buildGearServiceDueEmail', () => {
  it('names the gear, the part and the threshold in the subject', () => {
    expect(buildComponentEmail().subject).toBe(
      `Moots · Chain has passed 5,000 km in ${HOST}`
    )
  })

  it('omits the part from the subject for a shoes distance alert', () => {
    expect(buildShoesEmail().subject).toBe(
      `On Cloud Waterproof has passed 650 km in ${HOST}`
    )
  })

  it('tells a component owner they can replace the part', () => {
    const { html, text } = buildComponentEmail()
    expect(text).toContain('The chain on Moots has passed')
    expect(text).toContain('Replacing it from the gear page')
    expect(html).toContain('Your gear is due for service')
  })

  it('tells a shoes owner the pair may be worn out', () => {
    const { text } = buildShoesEmail()
    expect(text).toContain('500 and 800 km')
  })

  it('shows the reached distance beside the threshold', () => {
    const { text } = buildComponentEmail()
    expect(text).toContain('5,120 km')
    expect(text).toContain('5,000 km')
  })

  it('links to the gear page with an absolute url', () => {
    const { html, text } = buildComponentEmail()
    expect(html).toContain('/fitness/gear/gear-moots')
    expect(text).toContain('https://')
  })

  it('renders both an html and a plain-text alternative', () => {
    const { html, text } = buildShoesEmail()
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toContain('<table')
  })
})
