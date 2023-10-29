import * as linkify from 'linkifyjs'

import { getPublicProfileFromHandle } from '../activities'
import { Mention } from '../activities/entities/mention'
import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { getSpan } from '../trace'

interface GetMentionsParams {
  text: string
  currentActor: Actor
  replyStatus?: Status
}
export const getMentions = async ({
  text,
  currentActor,
  replyStatus
}: GetMentionsParams): Promise<Mention[]> => {
  const span = getSpan('link', 'getMentions', {
    text,
    actorId: currentActor.id,
    replyStatusId: replyStatus?.id
  })

  const mentions = await Promise.all(
    linkify
      .find(text)
      .filter((item) => item.type === 'mention')
      .map((item) => [item.value, item.value.slice(1).split('@')].flat())
      .map(async ([value, user, host]) => {
        try {
          const userHost = host ?? currentActor.domain
          const person = await getPublicProfileFromHandle(`${user}@${userHost}`)
          if (!person) return null
          return {
            type: 'Mention',
            href: person?.id ?? `https://${host}/users/${user}`,
            name: value
          } as Mention
        } catch {
          return null
        }
      })
  )

  if (replyStatus) {
    const name = replyStatus.actor
      ? Actor.getMentionFromProfile(replyStatus.actor, true)
      : Actor.getMentionFromId(replyStatus.actorId, true)

    mentions.push({
      type: 'Mention',
      href: replyStatus.actorId,
      name
    })
  }

  const mentionsMap = mentions
    .filter((item): item is Mention => item !== null)
    .reduce(
      (out, item) => {
        out[item.name] = item
        return out
      },
      {} as { [key: string]: Mention }
    )

  span.end()
  return Object.values(mentionsMap)
}
