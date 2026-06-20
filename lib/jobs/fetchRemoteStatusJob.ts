import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getNote } from '@/lib/activities'
import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { compactActivityPub } from '@/lib/activities/jsonld'
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

// Upper bound on how many reply notes a single fetch stores across the whole
// thread. It caps both the federation traffic and — because the in-process
// NoQueue runs this job inline with the page render — the request latency.
const MAX_REPLY_NOTES = 500

// Independent ceiling on total work units (one per collection page visited and
// one per item considered). Unlike `MAX_REPLY_NOTES` this also advances for
// skipped items and empty pages, so a malicious/buggy server cannot keep the
// walk spinning with junk items or an endless chain of empty inline pages while
// the stored-note count never moves. Generous enough that legitimate threads
// reach `MAX_REPLY_NOTES` before hitting it.
const MAX_FETCH_WORK = 5000

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

    // A single failed federation request (timeout, offline instance, non-JSON
    // body) must not abort the whole walk, so swallow errors here and return
    // null — the caller treats a null fetch as a skipped node. This matters all
    // the more because, under NoQueue, the walk runs inline with the page render
    // and an uncaught throw would 500 an otherwise-viewable status.
    const client = {
      fetch: async (url: string) => {
        if (!(await canFederateWithDomain(database, url))) return null
        try {
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
        } catch {
          return null
        }
      }
    }

    // Resolves a collection item into a stored Note and returns that note's own
    // `replies` reference (so its descendants can be queued), or null when the
    // item is missing, cannot be federated, or is not a Note. The `{ replies }`
    // wrapper distinguishes "a valid Note with no replies" (success) from a
    // skipped item (null). Already-stored notes are not rewritten but still
    // yield their `replies` so newly added descendants are picked up.
    const storeReplyNote = async (
      item: unknown
    ): Promise<{ replies: unknown } | null> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let doc: any = item
        if (typeof doc === 'string') {
          doc = await client.fetch(doc)
        }
        if (!doc) return null

        // Compact the untrusted document against the canonical offline context
        // before reading any AP terms, mirroring `getNote`. Without this a
        // remote that serves an expanded/aliased `type` or non-array fields
        // would be silently skipped or mis-shaped.
        doc = await compactActivityPub(doc)

        // Unwrap a Create activity into its Note object.
        if (doc.type === 'Create' && doc.object) {
          doc = doc.object
          if (typeof doc === 'string') {
            doc = await client.fetch(doc)
          }
          if (!doc) return null
          doc = await compactActivityPub(doc)
        }

        // Recurse using the compacted document's own `replies` ref, which keeps
        // its full shape; the validated note below has it narrowed/stripped.
        const childReplies = doc.replies

        // `replies`/`likes`/`shares` are opaque collection refs we never persist
        // and whose shape varies by server, so exclude them from validation — a
        // non-conforming collection must not discard an otherwise-valid note.
        const forValidation = { ...doc }
        delete forValidation.replies
        delete forValidation.likes
        delete forValidation.shares

        const noteResult = Note.safeParse(
          normalizeActivityPubContent(forValidation)
        )
        if (!noteResult.success) return null
        const sanitizedReply = noteResult.data

        const exists = await database.getStatus({ statusId: sanitizedReply.id })
        if (exists) return { replies: childReplies }

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

        return { replies: childReplies }
      } catch {
        return null
      }
    }

    const pendingCollections: unknown[] = []
    const visitedCollections = new Set<string>()

    const queueCollection = (collection: unknown) => {
      if (!collection) return
      // A `replies` ref can arrive as a URL string, an inlined collection
      // object, or — after JSON-LD compaction of a bare id ref — a `{ id }`
      // object with no inlined page. Reduce that last form to its URL so it
      // dedupes and resolves the same as a string ref.
      let ref: unknown = collection
      if (
        typeof collection === 'object' &&
        collection !== null &&
        typeof (collection as Record<string, unknown>).id === 'string' &&
        !('first' in collection) &&
        !('items' in collection) &&
        !('orderedItems' in collection)
      ) {
        ref = (collection as Record<string, unknown>).id
      }
      if (typeof ref === 'string') {
        if (visitedCollections.has(ref)) return
        visitedCollections.add(ref)
      }
      pendingCollections.push(ref)
    }

    queueCollection((note as Record<string, unknown>).replies)

    // `notesStored` is the meaningful cap (how many replies we persist);
    // `work` is the termination guard that advances on every page and every
    // item, so the walk always halts even when pages are empty or items are all
    // skipped — closing the inline-`next` / junk-item loops a stored-only count
    // would leave open.
    let notesStored = 0
    let work = 0
    const withinBudget = () =>
      notesStored < MAX_REPLY_NOTES && work < MAX_FETCH_WORK
    while (pendingCollections.length > 0 && withinBudget()) {
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

      while (page && withinBudget()) {
        work++
        const items = page.orderedItems || page.items || []
        for (const item of items) {
          if (!withinBudget()) break
          work++
          const stored = await storeReplyNote(item)
          if (stored) {
            notesStored++
            queueCollection(stored.replies)
          }
        }

        if (!withinBudget()) break

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
