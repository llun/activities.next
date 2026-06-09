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

    // 8. Fetch replies (up to 100)
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

    const replies = (note as Record<string, unknown>).replies
    if (!replies) return

    let collection = replies
    if (typeof replies === 'string') {
      collection = await client.fetch(replies)
    }

    if (!collection) return

    // Get first page
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let page = (collection as any).first
    if (typeof page === 'string') {
      page = await client.fetch(page)
    }

    let itemsFetched = 0

    while (page && itemsFetched < 100) {
      const items = page.orderedItems || page.items || []

      // Process items in parallel
      await Promise.all(
        items.map(async (item: unknown) => {
          if (itemsFetched >= 100) return
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let activityOrNote: any = item

          if (typeof item === 'string') {
            activityOrNote = await client.fetch(item)
          }

          if (!activityOrNote) return

          // If it's a Create activity, extract object
          if (activityOrNote.type === 'Create' && activityOrNote.object) {
            activityOrNote = activityOrNote.object
            if (typeof activityOrNote === 'string') {
              activityOrNote = await client.fetch(activityOrNote)
            }
          }

          if (!activityOrNote || activityOrNote.type !== 'Note') return

          // Check if already exists
          const exists = await database.getStatus({
            statusId: activityOrNote.id
          })
          if (exists) {
            itemsFetched++
            return
          }

          // Sanitize and store actor
          const sanitizedReply = normalizeActivityPubContent(
            activityOrNote
          ) as Note
          if (
            !(await canFederateWithDomain(
              database,
              sanitizedReply.attributedTo
            ))
          ) {
            return
          }

          const actor = await recordActorIfNeeded({
            actorId: sanitizedReply.attributedTo,
            database,
            signingActor
          })
          if (!actor) return

          // Create reply status
          const replyTo = toRecipientArray(sanitizedReply.to)
          const replyCc = toRecipientArray(sanitizedReply.cc)

          try {
            await database.createNote({
              id: sanitizedReply.id,
              url: sanitizedReply.url || sanitizedReply.id,
              actorId: sanitizedReply.attributedTo,
              text: Array.isArray(sanitizedReply.content)
                ? sanitizedReply.content.join('')
                : sanitizedReply.content || '',
              summary: sanitizedReply.summary || '',
              to: replyTo,
              cc: replyCc,
              reply: sanitizedReply.inReplyTo || '',
              createdAt: sanitizedReply.published
                ? new Date(sanitizedReply.published).getTime()
                : Date.now()
            })
          } catch {
            // Ignore error if status already exists
          }

          itemsFetched++
        })
      )

      if (itemsFetched >= 100) break

      // Next page
      if (page.next) {
        page =
          typeof page.next === 'string'
            ? await client.fetch(page.next)
            : page.next
      } else {
        break
      }
    }
  }
)
