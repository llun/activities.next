import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getNote } from '@/lib/activities'
import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { isActivityPubDocumentResponse } from '@/lib/activities/activityPubResponse'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { BaseNote, BaseNoteSchema, getUrl } from '@/lib/activities/note'
import { toCollectionItems } from '@/lib/activities/orderedCollection'
import { isPubliclyAddressed } from '@/lib/database/domains/status/status'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { getPollFieldsFromQuestion } from '@/lib/services/polls/pollChoices'
import { ENTITY_TYPE_QUESTION, Question } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import {
  extractActivityPubId,
  isSameActivityPubOrigin,
  normalizeActivityPubContent,
  normalizeActivityPubUri,
  toRecipientArray
} from '@/lib/utils/activitypub'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { createJobHandle } from './createJobHandle'
import { FETCH_REMOTE_STATUS_JOB_NAME } from './names'
import { createRemoteAttachments } from './noteAttachments'
import { persistNoteTags } from './noteTags'

interface FetchRemoteStatusResult {
  status: Status
  note?: BaseNote
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

// `firstPageOnly` runs inline with a page render under the default NoQueue, and
// the page is a single request a remote server's collection can stall. The
// 5000/500 budgets above are far too generous for that: an opening page of
// thousands of unfetchable item URLs would pin the request for as long as the
// remote chooses. So an inline run considers at most this many items and gives
// up after this long, whichever comes first; the queued run keeps the full
// budgets.
export const INLINE_MAX_REPLY_ITEMS = 30
export const INLINE_DEADLINE_MS = 6000

// A fetched note is a claim by whoever served it (see "A Fetched Document's Own
// `id` Is Not Evidence"). It may only name an id on the origin that served it —
// `servedFrom` — and only an author on its own origin; otherwise any logged-in
// viewer could make this instance store a status planted in a third party's id
// space, or attributed to a third party's actor.
//
// The top-level note is gated before `normalizeActivityPubContent` runs, and an
// embedded actor object or a multi-valued array (PeerTube names the account AND
// the channel) survives JSON-LD compaction as-is. Gate the author id
// `extractActivityPubId` picks — the id normalization goes on to store — as
// `dispatchCreateNoteOrPollJob` does, not the raw value.
const isAuthoritativeNote = (
  note: { id?: unknown; attributedTo?: unknown },
  servedFrom: string
): boolean =>
  typeof note.id === 'string' &&
  isSameActivityPubOrigin(note.id, servedFrom) &&
  isSameActivityPubOrigin(extractActivityPubId(note.attributedTo), note.id)

// Stores the attachments and tags of a note this job inserted for the first
// time. Only a publicly addressed note may move the hashtag counter (it is
// served to anonymous /tags/<tag> visitors), so the counter loop is gated on
// `isPubliclyAddressed`. A failure storing attachments or tags must not lose
// the already-inserted note nor abort the thread walk, so each step is logged
// and swallowed.
const storeNewNoteSideEffects = async (
  database: Database,
  statusId: string,
  note: BaseNote
) => {
  try {
    await createRemoteAttachments({ database, statusId, note })
  } catch (err) {
    logger.error({
      message: 'Failed to store fetched note attachments',
      statusId,
      err: toLoggableError(err)
    })
  }
  try {
    const hashtags = await persistNoteTags({ database, statusId, note })
    // The count is served to anonymous /tags/<tag> visitors; a followers-only
    // or direct note must not move it.
    if (
      isPubliclyAddressed({
        to: toRecipientArray(note.to),
        cc: toRecipientArray(note.cc)
      })
    ) {
      for (const hashtag of hashtags) {
        await database.increaseHashtagCounter({ hashtag: hashtag.slice(1) })
      }
    }
    if (hashtags.length > 0) {
      await database.indexHashtagSearchDocuments({ hashtags })
    }
  } catch (err) {
    logger.error({
      message: 'Failed to store fetched note tags',
      statusId,
      err: toLoggableError(err)
    })
  }
}

// Writes a fetched note this job has gated. A `Question` is stored as a Poll
// with its choices, the same shape createPollJob gives an inbound poll, so it
// can be voted on; storing it as a Note would leave it unvotable for good,
// since the row then exists and is never re-stored. createPollJob itself is not
// used because it fans the poll out to home timelines, which this job never
// does. A Question that does not parse as one is stored as a Note, so it stays
// viewable and the parent chain above it is still fetched.
const createFetchedStatus = async (
  database: Database,
  note: BaseNote,
  actorId: string,
  createdAt: number
): Promise<{ isNew: boolean }> => {
  const fields = {
    id: note.id,
    url: getUrl(note.url) || note.id,
    actorId,
    text: Array.isArray(note.content)
      ? note.content.join('')
      : note.content || '',
    summary: note.summary || '',
    sensitive: note.sensitive === true,
    to: toRecipientArray(note.to),
    cc: toRecipientArray(note.cc),
    reply: note.inReplyTo || '',
    createdAt
  }
  if (note.type === ENTITY_TYPE_QUESTION) {
    const question = Question.safeParse(note)
    if (question.success) {
      return database.createPollWithResult({
        ...fields,
        ...getPollFieldsFromQuestion(question.data, createdAt)
      })
    }
  }
  return database.createNoteWithResult(fields)
}

// Guard against an invalid `published` string: the note schemas only check it
// is a string, so a non-date value would yield `NaN` and corrupt sorting once
// written.
const getCreatedAt = (published: string | undefined | null) => {
  const publishedTime = published ? new Date(published).getTime() : Date.now()
  return Number.isNaN(publishedTime) ? Date.now() : publishedTime
}

// The form a note reference is compared in when the thread walk checks a
// reply's `inReplyTo`: scheme and host lower-cased, and a trailing slash
// dropped, so `…/1` and `…/1/` name the same note.
const threadKey = (id: string | null | undefined): string | null => {
  const normalized = normalizeActivityPubUri(id)
  if (!normalized) return null
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

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
  if (!isAuthoritativeNote(note, statusId)) return null

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
  const sanitizedNote = normalizeActivityPubContent(note) as BaseNote
  const actor = await recordActorIfNeeded({
    actorId: sanitizedNote.attributedTo,
    database,
    signingActor
  })
  if (!actor) return null

  // 5. Create status in database
  let noteWasInserted = false
  try {
    const { isNew } = await createFetchedStatus(
      database,
      sanitizedNote,
      // The recorded row's id: an alias author (`/@bob`) is stored under the
      // id its origin names, and the status must point at that row.
      actor.id,
      getCreatedAt(sanitizedNote.published)
    )
    noteWasInserted = isNew
  } catch {
    // Ignore error if status already exists
  }

  if (noteWasInserted) {
    await storeNewNoteSideEffects(database, sanitizedNote.id, sanitizedNote)
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
    // `firstPageOnly` keeps an inline (NoQueue) run cheap: it stores just the
    // focused note's direct replies (the opening page, no recursion) so awaiting
    // the job during a page render stays fast. A real queue processes the job
    // out of band and walks the full nested thread.
    const { statusId, firstPageOnly } = z
      .object({ statusId: z.string(), firstPageOnly: z.boolean().optional() })
      .parse(message.data)
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
          const response = await request({
            url,
            // Every document is bound to the URL it was fetched from, so
            // another host must not answer for it.
            allowCrossHostRedirects: false,
            headers: activityPubRequestHeaders({
              url,
              signingActor,
              accept: 'application/activity+json'
            })
          })
          if (!isActivityPubDocumentResponse(response, url)) return null
          return JSON.parse(response.body)
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
    //
    // `servedFrom` is the URL of the document the item came from: the page it
    // was inlined in, or the item's own URL once it is fetched separately.
    //
    // An item is stored only when its `inReplyTo` names a note of this thread:
    // the focused note or a reply this walk already accepted, by id or by url
    // (Mastodon resolves `inReplyTo` by either). That allows the flat
    // conversation collections some servers serve, while a collection still
    // cannot plant an unrelated note or graft one into this thread.
    const threadKeys = new Set<string>()
    // A note's `url` is the author's own claim, so it names the note only when
    // it is on the note id's origin (Mastodon's `/@alice/123` beside
    // `/users/alice/statuses/123`). A url on another host would let a reply
    // pull that host's unrelated thread into this conversation.
    const addToThread = (id: string, url?: string | null) => {
      const idKey = threadKey(id)
      if (idKey) threadKeys.add(idKey)
      if (!url || !isSameActivityPubOrigin(url, id)) return
      const urlKey = threadKey(url)
      if (urlKey) threadKeys.add(urlKey)
    }
    addToThread(
      result.status.id,
      'url' in result.status ? result.status.url : null
    )
    addToThread(note.id, getUrl(note.url))

    const storeReplyNote = async (
      item: unknown,
      pageServedFrom: string
    ): Promise<{
      replies: unknown
      repliesServedFrom: string
      newlyStored: boolean
    } | null> => {
      try {
        let servedFrom = pageServedFrom
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let doc: any = item
        if (typeof doc === 'string') {
          servedFrom = doc
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
            servedFrom = doc
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
        // Rest-destructure rather than `delete` so V8 keeps the fast object
        // shape on this hot path.
        const {
          replies: _replies,
          likes: _likes,
          shares: _shares,
          ...forValidation
        } = doc

        const noteResult = BaseNoteSchema.safeParse(
          normalizeActivityPubContent(forValidation)
        )
        if (!noteResult.success) return null
        const sanitizedReply = noteResult.data
        if (!isAuthoritativeNote(sanitizedReply, servedFrom)) return null

        // Only a reply within this thread, and only one addressed to the
        // public (public or unlisted), as the focused note and every other
        // fetch path require: a followers-only or direct reply this instance's
        // signer was shown must not become readable to every local viewer.
        const inReplyTo = threadKey(sanitizedReply.inReplyTo)
        if (!inReplyTo || !threadKeys.has(inReplyTo)) return null
        if (
          !isPubliclyAddressed({
            to: toRecipientArray(sanitizedReply.to),
            cc: toRecipientArray(sanitizedReply.cc)
          })
        ) {
          return null
        }

        // Already-cached notes don't count toward `notesStored` (the new-store
        // budget) but still yield their `replies`, so a re-fetch can traverse
        // the cached part of the thread to discover newly added descendants
        // (bounded by the `work` cap).
        const exists = await database.getStatus({ statusId: sanitizedReply.id })
        if (exists) {
          addToThread(exists.id)
          addToThread(sanitizedReply.id, getUrl(sanitizedReply.url))
          return {
            replies: childReplies,
            repliesServedFrom: servedFrom,
            newlyStored: false
          }
        }

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
          const { isNew: replyWasInserted } = await createFetchedStatus(
            database,
            sanitizedReply,
            actor.id,
            getCreatedAt(sanitizedReply.published)
          )
          if (replyWasInserted) {
            await storeNewNoteSideEffects(
              database,
              sanitizedReply.id,
              sanitizedReply
            )
          }
        } catch {
          // Ignore error if status already exists
        }
        addToThread(sanitizedReply.id, getUrl(sanitizedReply.url))

        return {
          replies: childReplies,
          repliesServedFrom: servedFrom,
          newlyStored: true
        }
      } catch {
        return null
      }
    }

    // Each queued collection carries the URL of the document it was found in,
    // which is what an inlined collection's items are answerable to.
    const pendingCollections: Array<{ ref: unknown; servedFrom: string }> = []
    const visitedCollections = new Set<string>()

    const queueCollection = (collection: unknown, servedFrom: string) => {
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
      pendingCollections.push({ ref, servedFrom })
    }

    queueCollection((note as Record<string, unknown>).replies, statusId)

    // `notesStored` is the meaningful cap (how many replies we persist);
    // `work` is the termination guard that advances on every page and every
    // item, so the walk always halts even when pages are empty or items are all
    // skipped — closing the inline-`next` / junk-item loops a stored-only count
    // would leave open.
    let notesStored = 0
    let work = 0
    let itemsConsidered = 0
    const deadline = firstPageOnly ? Date.now() + INLINE_DEADLINE_MS : null
    const withinBudget = () =>
      notesStored < MAX_REPLY_NOTES &&
      work < MAX_FETCH_WORK &&
      (!firstPageOnly || itemsConsidered < INLINE_MAX_REPLY_ITEMS) &&
      (deadline === null || Date.now() < deadline)
    // Under a deadline, stop waiting on an item the moment it passes, instead of
    // letting one slow fetch (the remote request has its own timeout and
    // retries) outlast it. The abandoned work finishes, or fails, on its own.
    const storeWithinDeadline = async (item: unknown, servedFrom: string) => {
      if (deadline === null) return storeReplyNote(item, servedFrom)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          storeReplyNote(item, servedFrom),
          new Promise<null>((resolve) => {
            timer = setTimeout(
              () => resolve(null),
              Math.max(0, deadline - Date.now())
            )
          })
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    while (pendingCollections.length > 0 && withinBudget()) {
      const pending = pendingCollections.shift()
      if (!pending) break
      let { ref: collection, servedFrom: pageServedFrom } = pending
      if (typeof collection === 'string') {
        pageServedFrom = collection
        collection = await client.fetch(collection)
      }
      if (!collection) continue

      // Some servers inline the items on the collection itself; otherwise follow
      // `first` into the opening CollectionPage. Dedupe a string `first` ref the
      // same way as `next`, so a collection pointing `first` at an already-seen
      // page can't cause a redundant fetch or a cycle.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let page: any = (collection as any).first ?? collection
      if (typeof page === 'string') {
        if (visitedCollections.has(page)) {
          page = null
        } else {
          visitedCollections.add(page)
          pageServedFrom = page
          page = await client.fetch(page)
        }
      }

      while (page && withinBudget()) {
        work++
        for (const item of toCollectionItems(page.orderedItems ?? page.items)) {
          if (!withinBudget()) break
          work++
          itemsConsidered++
          const stored = await storeWithinDeadline(item, pageServedFrom)
          if (stored) {
            // Only newly stored notes count toward the store budget, so a
            // re-fetch can keep traversing already-cached parts of the thread to
            // find new replies instead of halting at the cap.
            if (stored.newlyStored) notesStored++
            // First-page mode stores only direct replies, so it never recurses
            // into a child's own thread.
            if (!firstPageOnly) {
              queueCollection(stored.replies, stored.repliesServedFrom)
            }
          }
        }

        if (!withinBudget()) break

        // First-page mode stops after the opening page of the focused note's
        // replies — no pagination, no recursion — so an inline run can't fan out
        // into a long chain of sequential federation requests.
        if (firstPageOnly) break

        // Follow pagination within the current collection.
        if (!page.next) break
        if (typeof page.next === 'string') {
          if (visitedCollections.has(page.next)) break
          visitedCollections.add(page.next)
          pageServedFrom = page.next
          page = await client.fetch(page.next)
        } else {
          page = page.next
        }
      }
    }
  }
)
