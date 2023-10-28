import * as linkify from 'linkifyjs'
import _ from 'lodash'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

import { getPublicProfileFromHandle } from './activities'
import { Mention } from './activities/entities/mention'
import { getConfig } from './config'
import './linkify-mention'
import { Actor } from './models/actor'
import { Status } from './models/status'
import { getSpan } from './trace'

const LINK_BODY_LIMIT = 25

function mentionBody(url = '', username = '') {
  return `<span class="h-card"><a href="${url}" target="_blank" class="u-url mention">@<span>${username}</span></a></span>`
}

function linkBody(url = '') {
  let link
  try {
    link = new URL(url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export const linkifyText = (text: string) => {
  const tokens = linkify.tokenize(text)
  const texts = tokens.map((item) => {
    if (item.t === 'mention') {
      return mentionBody(
        `https://${getConfig().host}/${item.v}`,
        item.v.slice(1)
      )
    }

    if (item.t === 'url') {
      return linkBody(item.v)
    }

    return item.v
  })
  return texts.join('')
}

export const convertMarkdownText = (text: string) =>
  marked.parse(text, { gfm: false })

// Support the same tags as Mastodon here
// https://github.com/mastodon/mastodon/blob/eae5c7334ae61c463edd2e3cd03115b897f6e92b/lib/sanitize_ext/sanitize_config.rb
export const sanitizeText = (text: string) =>
  sanitizeHtml(text, {
    allowedTags: [
      'p',
      'br',
      'span',
      'a',
      'del',
      'pre',
      'blockquote',
      'code',
      'b',
      'strong',
      'u',
      'i',
      'em',
      'ul',
      'ol',
      'li'
    ],
    allowedAttributes: {
      a: ['href', 'rel', 'class', 'translate'],
      span: ['class', 'translate'],
      ol: ['start', 'reversed'],
      li: ['value']
    },
    allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
    textFilter: (text, tagName) => {
      if (['code', 'pre', 'a'].includes(tagName)) return text
      return linkifyText(text)
    }
  })

export const formatText = (text: string) =>
  _.chain(text).thru(convertMarkdownText).thru(sanitizeText).value().trim()

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
