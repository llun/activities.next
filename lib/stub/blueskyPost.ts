import type { Database } from '@/lib/database/types'

// Stores a Bluesky account and one of its posts the way the Home sync does,
// for tests of what may be done with a Bluesky post. `key` keeps the DID (and
// so the ids) apart between tests; letters only, as a did:plc is base32.
export const storeBlueskyPost = async (database: Database, key: string) => {
  const did = `did:plc:${key
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .padEnd(24, 'z')
    .slice(0, 24)}`
  const actorId = (await database.upsertBlueskyActor({
    did,
    handle: `${key.toLowerCase()}.bsky.social`
  })) as string
  const { statusId } = await database.upsertBlueskyPost({
    uri: `at://${did}/app.bsky.feed.post/${key}`,
    cid: `cid-${key}`,
    did,
    rkey: key,
    actorId,
    text: '<p>A Bluesky post</p>',
    createdAt: Date.now(),
    attachments: []
  })
  return { actorId, statusId }
}
