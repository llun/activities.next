import parse from 'html-react-parser'

import styles from './text.module.scss'

interface replacingNode {
  name: string
  attribs?: {
    [key in string]: string
  }
}

export const cleanClassName = (text: string) =>
  parse(text, {
    replace: (domNode) => {
      const node = domNode as replacingNode
      if (node.name === 'span') {
        if (node.attribs?.class === 'invisible') {
          node.attribs.class = styles.invisible
        }
        if (node.attribs?.class === 'ellipsis') {
          node.attribs.class = styles.ellipsis
        }
      }
      if (node.attribs && node.name === 'a') {
        node.attribs.target = '_blank'
        return node
      }

      return domNode
    }
  })
