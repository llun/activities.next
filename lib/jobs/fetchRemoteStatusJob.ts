import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getNote } from '@/lib/activities'
import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Note } from '@/lib/types/activitypub/objects'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import {
  normalizeActivityPubContent,
  toRecipientArray
} from '@/lib/utils/activitypub'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { request } from '@/lib/utils/request'

import { createJobHandle } from './createJobHandle'
import { FETCH_REMOTE_STATUS_JOB_NAME } from './names'

interface FetchRemoteStatusResult {
  status: Status
  note?: Note
}

// Upper bound on how many reply notes a single fetch walks across the whole
// thread. It caps both the federation traffic and — because the in-process
// NoQueue runs this job inline with the page render — the request latency.
const MAX_REPLY_NOTES = 500

const fetchRemoteStatus = async (
  database: Database,
  statusId: string,
  depth = 0,
  signingActor?: Actor
): Promise<FetchRemoteStatusResult | null> => {
  if (depth > 3) return null
  if (!(await canFederateWithDomain(database, statusId))) return null

  // 1. Check if already in database
  const existing = await database.getStatus({ statusId })
  if (existing) return { status: existing }

  // 2. Fetch the Note
  const note = await getNote({ statusId, signingActor })
  if (!note) return null

  // 3. Check if public
  const publicStreams = [
    ACTIVITY_STREAM_PUBLIC,
    'Public',
    ACTIVITY_STREAM_PUBLIC_COMPACT
  ]
  const isPublic =
    (Array.isArray(note.to) &&
      note.to.some((item) => publicStreams.includes(item))) ||
    (Array.isArray(note.cc) &&
      note.cc.some((item) => publicStreams.includes(item))) ||
    publicStreams.includes(note.to as string) ||
    publicStreams.includes(note.cc as string)

  if (!isPublic) return null

  // 4. Sanitize and store actor
  const sanitizedNote = normalizeActivityPubContent(note) as Note
  const actor = await recordActorIfNeeded({
    actorId: sanitizedNote.attributedTo,
    database,
    signingActor
  })
  if (!actor) return null

  // 5. Create status in database
  const to = toRecipientArray(sanitizedNote.to)
  const cc = toRecipientArray(sanitizedNote.cc)

  try {
    await database.createNote({
      id: sanitizedNote.id,
      url: sanitizedNote.url || sanitizedNote.id,
      actorId: sanitizedNote.attributedTo,
      text: Array.isArray(sanitizedNote.content)
        ? sanitizedNote.content.join('')
        : sanitizedNote.content || '',
      summary: sanitizedNote.summary || '',
      to,
      cc,
      reply: sanitizedNote.inReplyTo || '',
      createdAt: sanitizedNote.published
        ? new Date(sanitizedNote.published).getTime()
        : Date.now()
    })
  } catch {
    // Ignore error if status already exists
  }

  // 6. Get the created status
  const status = await database.getStatus({ statusId: sanitizedNote.id })

  // 7. Fetch parent (if any)
  if (status && status.type !== StatusType.enum.Announce && status.reply) {
    await fetchRemoteStatus(database, status.reply, depth + 1, signingActor)
  }

  if (!status) return null

  return { status, note: sanitizedNote }
}

export const fetchRemoteStatusJob = createJobHandle(
  FETCH_REMOTE_STATUS_JOB_NAME,
  async (database, message) => {
    const { statusId } = z.object({ statusId: z.string() }).parse(message.data)
    const signingActor = await getFederationSigningActor(database)

    const result = await fetchRemoteStatus(database, statusId, 0, signingActor)
    if (!result) return

    // 8. Fetch the reply thread.
    //
    // A remote note's `replies` collection only lists its *direct* children, so
    // to mirror the origin server's full conversation we walk the thread
    // breadth-first: every note we store has its own `replies` collection queued
    // for fetching. A visited set guards against cycles and `MAX_REPLY_NOTES`
    // bounds the work (and, under the in-process NoQueue, the render latency).
    const note = result.note ?? (await getNote({ statusId, signingActor }))
    if (!note) return

    const client = {
      fetch: async (url: string) => {
        if (!(await canFederateWithDomain(database, url))) return null
        const { body, statusCode } = await request({
          url,
          headers: activityPubRequestHeaders({
            url,
            signingActor,
            accept: 'application/activity+json'
          })
        })
        if (statusCode !== 200) return null
        return JSON.parse(body)
      }
    }

    // Resolves a collection item into a stored Note and returns that note's own
    // `replies` reference (so its descendants can be queued), or null when the
    // item is missing, cannot be federated, or is not a Note. Already-stored
    // notes are not rewritten but still yield their `replies` so newly added
    // descendants are picked up on a later fetch.
    const storeReplyNote = async (item: unknown): Promise<unknown> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let activityOrNote: any = item
      if (typeof item === 'string') {
        activityOrNote = await client.fetch(item)
      }
      if (!activityOrNote) return null

      // Unwrap a Create activity into its Note object.
      if (activityOrNote.type === 'Create' && activityOrNote.object) {
        activityOrNote = activityOrNote.object
        if (typeof activityOrNote === 'string') {
          activityOrNote = await client.fetch(activityOrNote)
        }
      }
      if (!activityOrNote || activityOrNote.type !== 'Note') return null

      const childReplies = activityOrNote.replies

      const exists = await database.getStatus({ statusId: activityOrNote.id })
      if (exists) return childReplies

      const sanitizedReply = normalizeActivityPubContent(activityOrNote) as Note
      if (
        !(await canFederateWithDomain(database, sanitizedReply.attributedTo))
      ) {
        return null
      }

      const actor = await recordActorIfNeeded({
        actorId: sanitizedReply.attributedTo,
        database,
        signingActor
      })
      if (!actor) return null

      try {
        await database.createNote({
          id: sanitizedReply.id,
          url: sanitizedReply.url || sanitizedReply.id,
          actorId: sanitizedReply.attributedTo,
          text: Array.isArray(sanitizedReply.content)
            ? sanitizedReply.content.join('')
            : sanitizedReply.content || '',
          summary: sanitizedReply.summary || '',
          to: toRecipientArray(sanitizedReply.to),
          cc: toRecipientArray(sanitizedReply.cc),
          reply: sanitizedReply.inReplyTo || '',
          createdAt: sanitizedReply.published
            ? new Date(sanitizedReply.published).getTime()
            : Date.now()
        })
      } catch {
        // Ignore error if status already exists
      }

      return childReplies
    }

    const pendingCollections: unknown[] = []
    const visitedCollections = new Set<string>()

    const queueCollection = (collection: unknown) => {
      if (!collection) return
      if (typeof collection === 'string') {
        if (visitedCollections.has(collection)) return
        visitedCollections.add(collection)
      }
      pendingCollections.push(collection)
    }

    queueCollection((note as Record<string, unknown>).replies)

    let notesFetched = 0
    while (pendingCollections.length > 0 && notesFetched < MAX_REPLY_NOTES) {
      let collection = pendingCollections.shift()
      if (typeof collection === 'string') {
        collection = await client.fetch(collection)
      }
      if (!collection) continue

      // Some servers inline the items on the collection itself; otherwise follow
      // `first` into the opening CollectionPage.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let page: any = (collection as any).first ?? collection
      if (typeof page === 'string') {
        page = await client.fetch(page)
      }

      while (page && notesFetched < MAX_REPLY_NOTES) {
        const items = page.orderedItems || page.items || []
        for (const item of items) {
          if (notesFetched >= MAX_REPLY_NOTES) break
          const childReplies = await storeReplyNote(item)
          notesFetched++
          queueCollection(childReplies)
        }

        if (notesFetched >= MAX_REPLY_NOTES) break

        // Follow pagination within the current collection.
        if (!page.next) break
        if (typeof page.next === 'string') {
          if (visitedCollections.has(page.next)) break
          visitedCollections.add(page.next)
          page = await client.fetch(page.next)
        } else {
          page = page.next
        }
      }
    }
  }
)
