import parse, {
  DOMNode,
  Element,
  HTMLReactParserOptions,
  domToReact
} from 'html-react-parser'
import React from 'react'

interface replacingNode {
  name: string
  attribs?: {
    [key in string]: string
  }
}

const TAG_REGEX = /^[a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*$/

export const extractTagFromHref = (
  href: string | undefined
): string | undefined => {
  if (!href) return undefined
  try {
    const pathname = href.startsWith('http') ? new URL(href).pathname : href
    const match = pathname.match(/\/tags\/([^/?#]+)/)
    if (!match) return undefined
    const tag = decodeURIComponent(match[1]).toLowerCase()
    return TAG_REGEX.test(tag) ? tag : undefined
  } catch {
    return undefined
  }
}

const hasToken = (value: string | undefined, token: string): boolean =>
  value?.split(/\s+/).includes(token) ?? false

export const cleanClassName = (
  text: string,
  // Mastodon's legacy quote fallback ("RE: <link>") is redundant exactly when
  // the caller renders the quote structurally, so hiding it is the caller's
  // decision: `post.tsx` opts in whenever it renders a quote card, while a
  // surface with no card leaves the fallback visible as the reader's only
  // clue. The marker rides on a `p` (Mastodon 4.5), a `span` (the older
  // appended convention), or — rarely — the anchor itself.
  { hideQuoteInline = false }: { hideQuoteInline?: boolean } = {}
) => {
  const options: HTMLReactParserOptions = {
    replace: (node: DOMNode) => {
      const replacingNode = node as replacingNode
      if (
        hideQuoteInline &&
        (replacingNode.name === 'p' || replacingNode.name === 'span') &&
        replacingNode.attribs &&
        hasToken(replacingNode.attribs.class, 'quote-inline')
      ) {
        replacingNode.attribs.class = 'hidden'
      }
      if (replacingNode.name === 'span') {
        if (replacingNode.attribs?.class === 'invisible') {
          replacingNode.attribs.class = 'hidden'
        }
        if (replacingNode.attribs?.class === 'ellipsis') {
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

        if (tagName) {
          replacingNode.attribs.href = `/tags/${tagName}`
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
        return React.createElement(
          'a',
          {
            ...restAttribs,
            className:
              hideQuoteInline && hasToken(className, 'quote-inline')
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
