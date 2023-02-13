import * as linkify from 'linkifyjs'

import { getPublicProfileFromHandle } from './activities'
import { Mention } from './activities/entities/mention'
import './linkify-mention'
import { Actor } from './models/actor'
import { Status } from './models/status'

const LINK_BODY_LIMIT = 25

function mentionBody(url = '', username = '') {
  return `<span class="h-card"><a href="${url}" target="_blank" class="u-url mention">@<span>${username}</span></a></span>`
}

function linkBody(url = '') {
  let link
  try {
    link = new URL(url)
  } catch (error: any) {
    if (error.code !== 'ERR_INVALID_URL') {
      throw error
    }
    link = new URL(`https://${url}`)
  }

  const hostname = link.host.startsWith('www.') ? link.host.slice(4) : link.host
  const pathnameWithSearch = `${link.pathname}${link.search}`
  const pathname =
    pathnameWithSearch.length > LINK_BODY_LIMIT
      ? `${pathnameWithSearch.slice(0, LINK_BODY_LIMIT)}…`
      : pathnameWithSearch
  return `<a href="${link.toString()}" target="_blank" rel="nofollow noopener noreferrer">${hostname}${
    pathname === '/' ? '' : pathname
  }</a>`
}

export async function linkifyText(text: string, mock?: boolean) {
  const tokens = linkify.tokenize(text)
  const texts = await Promise.all(
    tokens.map(async (item) => {
      if (item.t === 'mention') {
        if (mock) {
          const mention = item.v
          const fragments = mention.slice(1).split('@')
          if (fragments.length === 2) {
            const [user, domain] = fragments
            return mentionBody(`https://${domain}/@${user}`, user)
          }

          return mentionBody(`/@${fragments[0]}`, fragments[0])
        }
        const profile = await getPublicProfileFromHandle(item.v)
        return mentionBody(profile?.url, profile?.username)
      }
      if (item.t === 'url') {
        return linkBody(item.v)
      }
      return item.v
    })
  )
  return texts.join('')
}

export function paragraphText(text: string) {
  const texts = text.trim().split('\n')
  const groups: string[][] = []
  for (const text of texts) {
    let lastGroup: string[] = groups[groups.length - 1]
    if (!lastGroup) {
      lastGroup = []
      groups.push(lastGroup)
    }

    const lastItem = lastGroup[lastGroup.length - 1]
    if (lastItem === undefined) {
      lastGroup.push(text)
      continue
    }

    if (text.length > 0) {
      if (lastItem.length > 0) {
        lastGroup.push(text)
        continue
      }

      lastGroup = []
      groups.push(lastGroup)
      lastGroup.push(text)
      continue
    }

    if (lastItem.length === 0) {
      lastGroup.push(text)
      continue
    }

    lastGroup = []
    groups.push(lastGroup)
    lastGroup.push(text)
  }

  const messages = groups
    .map((group) => {
      const item = group[group.length - 1]
      if (item.length === 0 && group.length === 1) {
        return ''
      }
      if (item.length === 0 && group.length > 1) {
        return group
          .slice(1)
          .map(() => '<br />')
          .join('\n')
      }
      return `<p>${group.join('<br />')}</p>`
    })
    .filter((item) => item.length > 0)

  return messages.join('\n')
}

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
    .reduce((out, item) => {
      out[item.name] = item
      return out
    }, {} as { [key: string]: Mention })

  return Object.values(mentionsMap)
}
