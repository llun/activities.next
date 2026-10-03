import parse, {
  DOMNode,
  Element,
  HTMLReactParserOptions,
  domToReact
} from 'html-react-parser'
import React, { ReactNode } from 'react'

interface ReplacingNode {
  name: string
  attribs?: {
    [key in string]: string
  }
}

const hasToken = (value: string | undefined, token: string): boolean =>
  value?.split(/\s+/).includes(token) ?? false

const BLOCK_TAGS = new Set([
  'blockquote',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ol',
  'p',
  'pre',
  'ul'
])

export const renderInlineSnippet = (
  html: string | null | undefined
): ReactNode => {
  if (!html || !html.trim()) return null

  const options: HTMLReactParserOptions = {
    replace: (node: DOMNode) => {
      const replacingNode = node as ReplacingNode
      const element = node as Element

      if (replacingNode.name === 'br') {
        return <React.Fragment> </React.Fragment>
      }

      if (BLOCK_TAGS.has(replacingNode.name)) {
        return (
          <React.Fragment>
            {domToReact(element.children as DOMNode[], options)}{' '}
          </React.Fragment>
        )
      }

      if (replacingNode.attribs && replacingNode.name === 'span') {
        if (hasToken(replacingNode.attribs.class, 'invisible')) {
          return <React.Fragment />
        }
        if (hasToken(replacingNode.attribs.class, 'ellipsis')) {
          return (
            <React.Fragment>
              {domToReact(element.children as DOMNode[], options)}…
            </React.Fragment>
          )
        }
      }

      if (replacingNode.name === 'a') {
        return (
          <span className="text-primary">
            {domToReact(element.children as DOMNode[], options)}
          </span>
        )
      }

      if (replacingNode.name === 'img') {
        if (hasToken(replacingNode.attribs?.class, 'emoji')) {
          const { class: _c, ...rest } = replacingNode.attribs ?? {}
          return (
            <img
              {...rest}
              className="size-4 inline object-contain align-middle emoji"
              alt={replacingNode.attribs?.alt ?? ''}
            />
          )
        }
        return <React.Fragment />
      }

      return replacingNode
    }
  }

  return parse(html.trim(), options)
}
