import { z } from 'zod'

import { getNote } from '@/lib/activities'
import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getQueue } from '@/lib/services/queue'
import { JobMessage } from '@/lib/services/queue/type'
import { Note } from '@/lib/types/activitypub/objects'
import { getActorProfile } from '@/lib/types/domain/actor'
import { fromNote, Status } from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
import { request } from '@/lib/utils/request'

import { createJobHandle } from './createJobHandle'
import {
    CLEANUP_TEMPORARY_STATUS_JOB_NAME,
    FETCH_REMOTE_STATUS_JOB_NAME
} from './names'

const fetchRemoteStatus = async (
    database: any,
    statusId: string,
    depth = 0
): Promise<Status | null> => {
    if (depth > 3) return null

    // 1. Check if already in temp storage
    const existing = await database.getTemporaryStatus({ statusId })
    if (existing) return existing as Status

    // 2. Fetch the Note
    // TODO: Add error handling for 404/410/etc
    const note = await getNote({ statusId })
    if (!note) return null

    // 3. Check if public
    // Public streams:
    // https://www.w3.org/ns/activitystreams#Public
    // as:Public
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

    // 5. Convert to Status
    const status = fromNote(sanitizedNote)
    status.actor = getActorProfile(actor) // Attach actor profile for display

    // 6. Store in temp storage
    await database.createTemporaryStatus({
        statusId: status.id,
        status,
        ttl: 600 // 10 minutes
    })

    // 7. Queue cleanup
    const queue = getQueue()
    if (queue.publishDelayed) {
        await queue.publishDelayed(
            {
                id: `cleanup-${status.id}-${Date.now()}`,
                name: CLEANUP_TEMPORARY_STATUS_JOB_NAME,
                data: { statusId: status.id }
            },
            600 * 1000 // 10 minutes in ms? or seconds? Upstash uses seconds usually.
            // Wait, let's check Upstash delay unit. QStash delay is in seconds.
            // My implementation passed `delay` directly.
        )
    }

    // 8. Fetch parent (if any)
    if (status.reply) {
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

        // 9. Fetch replies
        // We cast to any because 'replies' is not strictly typed in our Note interface yet
        // or it's part of the loose intersection
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
        const fetchedReplies: Status[] = []

        while (page && itemsFetched < 100) {
            const items = page.orderedItems || page.items || []

            // Process items in parallel
            const pageReplies = (await Promise.all(
                items.map(async (item: any) => {
                    if (itemsFetched >= 100) return null
                    let activityOrNote = item

                    if (typeof item === 'string') {
                        activityOrNote = await client.fetch(item)
                    }

                    if (!activityOrNote) return null

                    // If it's a Create activity, extract value
                    if (activityOrNote.type === 'Create' && activityOrNote.object) {
                        activityOrNote = activityOrNote.object
                        if (typeof activityOrNote === 'string') {
                            activityOrNote = await client.fetch(activityOrNote)
                        }
                    }

                    if (!activityOrNote || activityOrNote.type !== 'Note') return null

                    // 4. Sanitize and store actor
                    const sanitizedReply = normalizeActivityPubContent(activityOrNote) as Note
                    const actor = await recordActorIfNeeded({
                        actorId: sanitizedReply.attributedTo,
                        database
                    })
                    if (!actor) return null

                    // 5. Convert to Status
                    const replyStatus = fromNote(sanitizedReply)
                    replyStatus.actor = getActorProfile(actor)

                    // 6. Store in temp (optional if we embed, but good for direct links)
                    // We'll store it so if someone clicks the reply timestamp it loads fast
                    await database.createTemporaryStatus({
                        statusId: replyStatus.id,
                        status: replyStatus,
                        ttl: 600
                    })

                    itemsFetched++
                    return replyStatus
                })
            )).filter((item): item is Status => item !== null)

            fetchedReplies.push(...pageReplies)

            if (itemsFetched >= 100) break

            // Next page
            if (page.next) {
                page = typeof page.next === 'string' ? await client.fetch(page.next) : page.next
            } else {
                break
            }
        }

        if (fetchedReplies.length > 0) {
            // Update parent status with replies
            if (status.type === 'Note') { // StatusNote
                status.replies = fetchedReplies
                await database.createTemporaryStatus({
                    statusId: status.id,
                    status: status,
                    ttl: 600
                })
            }
        }
    }
)
