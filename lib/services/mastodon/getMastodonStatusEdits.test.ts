import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getMastodonStatusEdits } from './getMastodonStatusEdits'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({ host: 'llun.test' })
}))

describe('getMastodonStatusEdits', () => {
  const knexInstance = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const database = getSQLDatabase(knexInstance)

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('renders per-revision sensitive flags and media from snapshots', async () => {
    const statusId = `${ACTOR1_ID}/statuses/edits-snapshot-note`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'First version',
      sensitive: true
    })
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/medias/edits-old.webp',
      width: 320,
      height: 240,
      name: 'old alt',
      mediaId: 'edits-old-media'
    })

    await database.updateNote({
      statusId,
      text: 'Second version',
      summary: null,
      sensitive: false,
      attachments: []
    })

    const status = (await database.getStatus({ statusId })) as StatusNote
    const edits = await getMastodonStatusEdits(database, status)

    expect(edits).toHaveLength(2)
    expect(edits[0]).toMatchObject({ sensitive: true })
    expect(edits[0].content).toContain('First version')
    expect(edits[0].media_attachments).toHaveLength(1)
    expect(edits[0].media_attachments[0]).toMatchObject({
      description: 'old alt',
      url: 'https://llun.test/api/v1/files/medias/edits-old.webp'
    })
    expect(edits[1]).toMatchObject({ sensitive: false })
    expect(edits[1].content).toContain('Second version')
    expect(edits[1].media_attachments).toEqual([])
  })

  it('falls back to current values for legacy revisions without snapshots', async () => {
    const statusId = `${ACTOR1_ID}/statuses/edits-legacy-note`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Live version',
      sensitive: true
    })
    // A history row written before snapshots existed: only text/summary.
    await knexInstance('status_history').insert({
      statusId,
      data: JSON.stringify({ text: 'Legacy version', summary: null }),
      createdAt: new Date(),
      updatedAt: new Date()
    })

    const status = (await database.getStatus({ statusId })) as StatusNote
    const edits = await getMastodonStatusEdits(database, status)

    expect(edits).toHaveLength(2)
    expect(edits[0].content).toContain('Legacy version')
    expect(edits[0]).toMatchObject({ sensitive: true })
    expect(edits[0].media_attachments).toEqual(edits[1].media_attachments)
  })
})
