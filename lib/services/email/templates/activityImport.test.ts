import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { buildActivityImportEmail } from './activityImport'

const HOST = 'test.llun.dev'
const BASE_URL = `https://${HOST}`

const recipient: ActorProfile = {
  id: `${BASE_URL}/users/anna`,
  username: 'anna',
  domain: HOST,
  name: 'Anna',
  followersUrl: '',
  inboxUrl: '',
  sharedInboxUrl: '',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1000
}

const status = (text = 'Morning run'): EditableStatus =>
  ({
    id: `${BASE_URL}/statuses/1`,
    url: `${BASE_URL}/@anna/1`,
    actorId: recipient.id,
    actor: recipient,
    isLocalActor: true,
    type: StatusType.enum.Note,
    text,
    summary: '',
    to: [],
    cc: [],
    tags: [],
    attachments: [],
    replies: [],
    createdAt: 1_700_000_000_000
  }) as unknown as EditableStatus

const fitness = (overrides: Partial<FitnessFile> = {}): FitnessFile =>
  ({
    id: 'file-1',
    actorId: recipient.id,
    path: 'a.fit',
    fileName: 'morning-run.fit',
    fileType: 'fit',
    mimeType: 'application/octet-stream',
    bytes: 100,
    totalDistanceMeters: 8210,
    totalDurationSeconds: 2538,
    movingTimeSeconds: 2538,
    activityType: 'running',
    activityStartTime: 1_700_000_000_000,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }) as FitnessFile

const build = (overrides = {}) =>
  buildActivityImportEmail({
    recipient,
    status: status(),
    fitness: fitness(),
    ...overrides
  })

describe('buildActivityImportEmail', () => {
  it('keeps the subject the codebase already used', () => {
    expect(build().subject).toBe(
      `Your fitness activity was imported in ${HOST}`
    )
  })

  it('never names the import provider', () => {
    const { subject, html, text } = build({
      mapImageUrl: `${BASE_URL}/api/v1/files/map.webp`
    })
    // The email is built from the status and its fitness file, so it reads the
    // same whether the activity came from Strava, a direct upload, or a future
    // integration.
    for (const rendered of [subject, html, text]) {
      expect(rendered.toLowerCase()).not.toContain('strava')
    }
  })

  it('sends the reader to the status the import created', () => {
    const { html } = build()
    expect(html).toContain('>View status</a>')
    expect(html).toContain(`href="${BASE_URL}/@anna@${HOST}/`)
  })

  it('titles the card from the status text', () => {
    expect(build({ status: status('Evening ride') }).html).toContain(
      '>Evening ride</td>'
    )
  })

  it('names the file it was imported from', () => {
    expect(build().text).toContain(
      'Imported from activity file · morning-run.fit'
    )
  })

  it('renders the route map when one was generated', () => {
    const { html } = build({
      mapImageUrl: `${BASE_URL}/api/v1/files/map.webp`
    })
    expect(html).toContain('alt="Route map"')
  })

  it('omits the map for an activity with no route', () => {
    expect(build().html).not.toContain('alt="Route map"')
  })

  it('labels the third stat by activity type', () => {
    // A run is paced; a ride is measured in average speed.
    expect(build().text).toContain('Pace:')
    expect(
      build({ fitness: fitness({ activityType: 'cycling' }) }).text
    ).toContain('Avg speed:')
  })

  it('drops a stat the file has no data for', () => {
    const { text } = build({
      fitness: fitness({
        totalDistanceMeters: undefined,
        movingTimeSeconds: undefined
      })
    })
    expect(text).not.toContain('Distance:')
    expect(text).toContain('Time:')
  })

  it('still sends when the import produced no fitness file at all', () => {
    const { html, text } = build({ fitness: undefined })
    expect(html).toContain('Your fitness activity was imported')
    expect(html).toContain('>View status</a>')
    expect(html).not.toContain('Distance')
    expect(text.length).toBeGreaterThan(0)
  })

  it('falls back to the activity type when the status has no text', () => {
    expect(build({ status: status('  ') }).html).toContain('>Running</td>')
  })

  it('falls back again when there is neither text nor activity type', () => {
    expect(
      build({
        status: status(''),
        fitness: fitness({ activityType: undefined })
      }).html
    ).toContain('>Fitness activity</td>')
  })

  it('truncates a very long status text for the card title', () => {
    const { html } = build({ status: status('x'.repeat(200)) })
    expect(html).toContain('…')
    expect(html).not.toContain('x'.repeat(120))
  })

  it('uses the notification footer naming fitness imports', () => {
    expect(build().html).toContain('email notifications for fitness imports')
  })
})
