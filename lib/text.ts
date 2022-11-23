import parse from 'html-react-parser'

import styles from './text.module.scss'

export const parseText = (text: string) =>
  parse(text, {
    replace: (domNode: any) => {
      if (domNode.name === 'span') {
        if (domNode.attribs?.class === 'invisible') {
          domNode.attribs.class = styles.invisible
        }
        if (domNode.attribs?.class === 'ellipsis') {
          domNode.attribs.class = styles.ellipsis
        }
      }
      if (domNode.attribs && domNode.name === 'a') {
        domNode.attribs.target = '_blank'
        return domNode
      }

      return domNode
    }
  })
