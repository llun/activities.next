import parse, {
  DOMNode,
  Element,
  HTMLReactParserOptions,
  domToReact
} from 'html-react-parser'
import Link from 'next/link'
import React from 'react'

import { Tag } from '@/lib/types/domain/tag'

import { extractProfileHref } from './extractProfileHref'
import { MAX_HASHTAG_NAME_LENGTH } from './mastodonHashtag'
import {
  hasToken,
  isEllipsisClass,
  isInvisibleClass,
  isQuoteInlineClass
} from './statusBodyClasses'

interface replacingNode {
  name: string
  attribs?: {
    [key in string]: string
  }
}

// An ASCII word with at least one letter or underscore. Written with a
// digits-only prefix rather than `[a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*`: the two
// accept exactly the same strings, but the overlapping classes made the old
// form backtrack quadratically on a long non-matching name (a remote hashtag
// href with a 40k-character path took 1.7 s), and this runs while rendering
// remote bios, posts and profile fields. A name longer than the stored
// hashtag limit is not a tag either, and is refused before the regex runs.
export const TAG_REGEX = /^[0-9]*[a-zA-Z_][a-zA-Z0-9_]*$/

export const extractTagFromHref = (
  href: string | undefined
): string | undefined => {
  if (!href) return undefined
  try {
    const pathname = href.startsWith('http') ? new URL(href).pathname : href
    const match = pathname.match(/\/tags\/([^/?#]+)/)
    if (!match) return undefined
    const tag = decodeURIComponent(match[1]).toLowerCase()
    if (tag.length > MAX_HASHTAG_NAME_LENGTH) return undefined
    return TAG_REGEX.test(tag) ? tag : undefined
  } catch {
    return undefined
  }
}

export interface CleanClassNameOptions {
  hideQuoteInline?: boolean
  host?: string
  tags?: Tag[]
  /**
   * Rewrite a link to a profile on this instance or a bridged one (for example
   * `bsky.app/profile/…`) into an in-app profile `Link`. On by default; a
   * surface that must keep the exact link the author wrote, such as a profile
   * field carrying `rel="me"`, turns it off.
   */
  rewriteProfileLinks?: boolean
}

export const cleanClassName = (
  text: string,
  // Mastodon's legacy quote fallback ("RE: <link>") is redundant exactly when
  // the caller renders the quote structurally, so hiding it is the caller's
  // decision: `post.tsx` opts in whenever it renders a quote card, while a
  // surface with no card leaves the fallback visible as the reader's only
  // clue. The marker rides on a `p` (Mastodon 4.5), a `span` (the older
  // appended convention), or — rarely — the anchor itself.
  {
    hideQuoteInline = false,
    host,
    tags,
    rewriteProfileLinks = true
  }: CleanClassNameOptions = {}
) => {
  const options: HTMLReactParserOptions = {
    replace: (node: DOMNode) => {
      const replacingNode = node as replacingNode
      if (
        hideQuoteInline &&
        (replacingNode.name === 'p' || replacingNode.name === 'span') &&
        replacingNode.attribs &&
        isQuoteInlineClass(replacingNode.attribs.class)
      ) {
        replacingNode.attribs.class = 'hidden'
      }
      if (replacingNode.name === 'span') {
        if (
          replacingNode.attribs &&
          isInvisibleClass(replacingNode.attribs.class)
        ) {
          replacingNode.attribs.class = 'hidden'
        }
        if (
          replacingNode.attribs &&
          isEllipsisClass(replacingNode.attribs.class)
        ) {
          replacingNode.attribs.class = 'after:content-["…"]'
        }
      }
      if (replacingNode.attribs && replacingNode.name === 'a') {
        const anchorElement = node as Element
        const isHashtag =
          hasToken(replacingNode.attribs.class, 'hashtag') &&
          hasToken(replacingNode.attribs.rel, 'tag')
        const tagName = isHashtag
          ? extractTagFromHref(replacingNode.attribs.href)
          : undefined

        const isMention = hasToken(replacingNode.attribs.class, 'mention')
        const profileHref =
          !tagName && rewriteProfileLinks
            ? extractProfileHref(replacingNode.attribs.href, {
                host,
                tags,
                isMention
              })
            : undefined

        if (tagName) {
          replacingNode.attribs.href = `/tags/${tagName}`
          delete replacingNode.attribs.target
          delete replacingNode.attribs.rel
        } else if (profileHref) {
          replacingNode.attribs.href = profileHref
          delete replacingNode.attribs.target
          delete replacingNode.attribs.rel
        } else {
          replacingNode.attribs.target = '_blank'
          const relTokens = new Set(
            (replacingNode.attribs.rel ?? '').split(/\s+/).filter(Boolean)
          )
          relTokens.add('noopener')
          relTokens.add('noreferrer')
          replacingNode.attribs.rel = [...relTokens].join(' ')
        }

        // Return a React element with onClick handler to stop propagation
        // Pass options to domToReact to preserve child transformations
        const { class: className, ...restAttribs } = replacingNode.attribs

        if (profileHref) {
          return React.createElement(
            Link,
            {
              ...restAttribs,
              href: profileHref,
              prefetch: false,
              className:
                hideQuoteInline && isQuoteInlineClass(className)
                  ? 'hidden'
                  : className,
              onClick: (e: React.MouseEvent) => e.stopPropagation()
            },
            domToReact(anchorElement.children as DOMNode[], options)
          )
        }

        return React.createElement(
          'a',
          {
            ...restAttribs,
            className:
              hideQuoteInline && isQuoteInlineClass(className)
                ? 'hidden'
                : className,
            onClick: (e: React.MouseEvent) => e.stopPropagation()
          },
          domToReact(anchorElement.children as DOMNode[], options)
        )
      }
      if (
        replacingNode.name === 'img' &&
        replacingNode.attribs?.class === 'emoji'
      ) {
        replacingNode.attribs.class = 'size-5 inline'
      }

      return replacingNode
    }
  }

  return parse(text, options)
}
