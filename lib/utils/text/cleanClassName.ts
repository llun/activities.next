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

export const cleanClassName = (text: string) => {
  const options: HTMLReactParserOptions = {
    replace: (node: DOMNode) => {
      const replacingNode = node as replacingNode
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
        replacingNode.attribs.target = '_blank'
        // Return a React element with onClick handler to stop propagation
        // Pass options to domToReact to preserve child transformations
        return React.createElement(
          'a',
          {
            ...replacingNode.attribs,
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
