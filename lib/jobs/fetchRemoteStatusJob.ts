import { z } from 'zod'

import { getNote } from '@/lib/activities'
import { recordActorIfNeeded } from '@/lib/actions/utils'
import { Note } from '@/lib/types/activitypub/objects'
import { Status } from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
import { request } from '@/lib/utils/request'

import { createJobHandle } from './createJobHandle'
import { FETCH_REMOTE_STATUS_JOB_NAME } from './names'

const fetchRemoteStatus = async (
    database: any,
    statusId: string,
    depth = 0
): Promise<Status | null> => {
    if (depth > 3) return null

    // 1. Check if already in database
    const existing = await database.getStatus({ statusId })
    if (existing) return existing

    // 2. Fetch the Note
    const note = await getNote({ statusId })
    if (!note) return null

    // 3. Check if public
    const publicStreams = [
        'https://www.w3.org/ns/activitystreams#Public',
        'Public',
        'as:Public'
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
        database
    })
    if (!actor) return null

    // 5. Create status in database
    const to = Array.isArray(sanitizedNote.to)
        ? sanitizedNote.to
        : sanitizedNote.to
            ? [sanitizedNote.to]
            : []
    const cc = Array.isArray(sanitizedNote.cc)
        ? sanitizedNote.cc
        : sanitizedNote.cc
            ? [sanitizedNote.cc]
            : []

    await database.createNote({
        id: sanitizedNote.id,
        url: sanitizedNote.url || sanitizedNote.id,
        actorId: sanitizedNote.attributedTo,
        text: sanitizedNote.content || '',
        summary: sanitizedNote.summary || '',
        to,
        cc,
        reply: sanitizedNote.inReplyTo || '',
        createdAt: sanitizedNote.published
            ? new Date(sanitizedNote.published).getTime()
            : Date.now()
    })

    // 6. Get the created status
    const status = await database.getStatus({ statusId: sanitizedNote.id })

    // 7. Fetch parent (if any)
    if (status && status.reply) {
        await fetchRemoteStatus(database, status.reply, depth + 1)
    }

    return status
}

export const fetchRemoteStatusJob = createJobHandle(
    FETCH_REMOTE_STATUS_JOB_NAME,
    async (database, message) => {
        const { statusId } = z
            .object({ statusId: z.string() })
            .parse(message.data)

        const status = await fetchRemoteStatus(database, statusId)
        if (!status) return

        // 8. Fetch replies (up to 100)
        const note = await getNote({ statusId })
        if (!note) return

        const client = {
            fetch: async (url: string) => {
                const { body, statusCode } = await request({
                    url,
                    headers: { Accept: 'application/activity+json' }
                })
                if (statusCode !== 200) return null
                return JSON.parse(body)
            }
        }

        const replies = (note as any).replies
        if (!replies) return

        let collection = replies
        if (typeof replies === 'string') {
            collection = await client.fetch(replies)
        }

        if (!collection) return

        // Get first page
        let page = collection.first
        if (typeof page === 'string') {
            page = await client.fetch(page)
        }

        let itemsFetched = 0

        while (page && itemsFetched < 100) {
            const items = page.orderedItems || page.items || []

            // Process items in parallel
            await Promise.all(
                items.map(async (item: any) => {
                    if (itemsFetched >= 100) return
                    let activityOrNote = item

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
                    const actor = await recordActorIfNeeded({
                        actorId: sanitizedReply.attributedTo,
                        database
                    })
                    if (!actor) return

                    // Create reply status
                    const replyTo = Array.isArray(sanitizedReply.to)
                        ? sanitizedReply.to
                        : sanitizedReply.to
                            ? [sanitizedReply.to]
                            : []
                    const replyCc = Array.isArray(sanitizedReply.cc)
                        ? sanitizedReply.cc
                        : sanitizedReply.cc
                            ? [sanitizedReply.cc]
                            : []

                    await database.createNote({
                        id: sanitizedReply.id,
                        url: sanitizedReply.url || sanitizedReply.id,
                        actorId: sanitizedReply.attributedTo,
                        text: sanitizedReply.content || '',
                        summary: sanitizedReply.summary || '',
                        to: replyTo,
                        cc: replyCc,
                        reply: sanitizedReply.inReplyTo || '',
                        createdAt: sanitizedReply.published
                            ? new Date(sanitizedReply.published).getTime()
                            : Date.now()
                    })

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
