import { XMLParser } from 'fast-xml-parser'

import { getNote } from '@/lib/activities'
import { detectLanguageFromHtml } from '@/lib/services/language-detection'
import { Actor } from '@/lib/types/activitypub'
import { Note } from '@/lib/types/activitypub/objects'
import { ActorProfile, Actor as DomainActor } from '@/lib/types/domain/actor'
import { Status, fromNote } from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { mapWithConcurrency } from '@/lib/utils/mapWithConcurrency'
import { request } from '@/lib/utils/request'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

// The remote server chooses how many entries its feed carries, and every entry
// is a separate signed GET back to that server, reachable from a logged-in
// profile render. Bound both the count and the concurrency so a hostile or
// simply large feed cannot fan out into an unbounded burst of outbound
// requests. 40 mirrors Mastodon's own maximum page size.
export const MAX_ATOM_FEED_ENTRIES = 40
export const ATOM_FEED_FETCH_CONCURRENCY = 8

interface AtomFeedLink {
  '@_href'?: string
  '@_rel'?: string
  '@_type'?: string
}

interface AtomFeedEntry {
  id?: string
  link?: AtomFeedLink | AtomFeedLink[]
  title?: string
  updated?: string
  published?: string
}

interface AtomFeedRoot {
  feed?: {
    entry?: AtomFeedEntry | AtomFeedEntry[]
  }
}

const getStatusFromNote = (note: Note): Status | null => {
  try {
    const status = fromNote(note)
    status.detectedLanguage =
      detectLanguageFromHtml(status.text)?.language ?? null
    return status
  } catch (error) {
    logger.error({
      message: 'Failed to build status from Atom feed note',
      err: toLoggableError(error)
    })
    return null
  }
}

const getCandidateAtomUrls = (person: Actor): string[] => {
  const urls: string[] = []
  try {
    const actorUrl = new URL(person.id)
    urls.push(`${person.id}.atom`)

    if (person.preferredUsername) {
      const userAtomUrl = `${actorUrl.origin}/users/${person.preferredUsername}.atom`
      if (!urls.includes(userAtomUrl)) {
        urls.push(userAtomUrl)
      }
    }
  } catch {
    // Malformed actor id URL
  }
  return urls
}

const extractEntryUrl = (entry: AtomFeedEntry): string | null => {
  if (entry.id && typeof entry.id === 'string' && entry.id.startsWith('http')) {
    return entry.id
  }

  if (entry.link) {
    if (Array.isArray(entry.link)) {
      const alternate = entry.link.find(
        (l) => !l['@_rel'] || l['@_rel'] === 'alternate'
      )
      if (alternate?.['@_href']) return alternate['@_href']
      if (entry.link[0]?.['@_href']) return entry.link[0]['@_href']
    } else if (entry.link['@_href']) {
      return entry.link['@_href']
    }
  }

  return null
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
})

export const getActorPostsFromAtomFeed = async ({
  person,
  signingActor,
  actor
}: {
  person: Actor
  signingActor?: DomainActor
  actor?: ActorProfile | DomainActor | null
}): Promise<Status[]> =>
  withSpan(
    'activity',
    'getActorPostsFromAtomFeed',
    { actorId: person.id },
    async () => {
      const candidateUrls = getCandidateAtomUrls(person)
      if (candidateUrls.length === 0) return []

      for (const atomUrl of candidateUrls) {
        try {
          const { statusCode, body } = await request({
            url: atomUrl,
            headers: {
              Accept:
                'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
              'User-Agent': 'activities.next'
            }
          })

          if (statusCode !== 200 || !body || typeof body !== 'string') {
            continue
          }

          const parsed = parser.parse(body) as AtomFeedRoot
          const entries = parsed.feed?.entry
          if (!entries) {
            continue
          }

          const entryList: AtomFeedEntry[] = Array.isArray(entries)
            ? entries
            : [entries]
          if (entryList.length === 0) {
            continue
          }

          // The remote server chooses the entry count, so cap it before the
          // fan-out; each surviving entry is a signed GET back to that server.
          const entryUrls = entryList
            .map(extractEntryUrl)
            .filter((url): url is string => Boolean(url))
            .slice(0, MAX_ATOM_FEED_ENTRIES)

          if (entryUrls.length === 0) {
            continue
          }

          // Bounded concurrency rather than `Promise.all` over the whole list:
          // an uncapped fan-out on a remote-chosen entry count is an unbounded
          // burst of outbound signed fetches.
          const statuses = await mapWithConcurrency(
            entryUrls,
            ATOM_FEED_FETCH_CONCURRENCY,
            async (entryUrl) => {
              try {
                const note = await getNote({
                  statusId: entryUrl,
                  signingActor
                })
                if (!note) return null

                const noteResult = Note.safeParse(
                  normalizeActivityPubContent(note)
                )
                if (!noteResult.success) return null

                const status = getStatusFromNote(noteResult.data)
                if (!status) return null

                if (actor) status.actor = actor
                return status
              } catch (error) {
                logger.warn({
                  message: 'Failed to fetch note for Atom feed entry',
                  entryUrl,
                  err: toLoggableError(error)
                })
                return null
              }
            }
          )

          const validStatuses = statuses.filter(
            (status): status is Status => status !== null
          )
          if (validStatuses.length > 0) {
            return validStatuses
          }
        } catch (error) {
          logger.warn({
            message: 'Failed to fetch or parse candidate Atom feed',
            atomUrl,
            err: toLoggableError(error)
          })
        }
      }

      return []
    }
  )
