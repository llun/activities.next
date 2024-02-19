import parse, { DOMNode } from 'html-react-parser'

import styles from './cleanClassName.module.scss'

interface replacingNode {
  name: string
  attribs?: {
    [key in string]: string
  }
}

export const cleanClassName = (text: string) =>
  parse(text, {
    replace: (node: DOMNode) => {
      const replacingNode = node as replacingNode
      if (replacingNode.name === 'span') {
        if (replacingNode.attribs?.class === 'invisible') {
          replacingNode.attribs.class = styles.invisible
        }
        if (replacingNode.attribs?.class === 'ellipsis') {
          replacingNode.attribs.class = styles.ellipsis
        }
      }
      if (replacingNode.attribs && replacingNode.name === 'a') {
        replacingNode.attribs.target = '_blank'
        return replacingNode
      }
      if (
        replacingNode.name === 'img' &&
        replacingNode.attribs?.class === 'emoji'
      ) {
        replacingNode.attribs.class = styles.emoji
      }

      return replacingNode
    }
  })
