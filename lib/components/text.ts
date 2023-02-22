import parse from 'html-react-parser'

import styles from './text.module.scss'

interface replacingNode {
  name: string
  attribs?: {
    [key in string]: string
  }
}

export const cleanClassName = (text: string) =>
  parse(convertQuoteToCode(text), {
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

export const convertQuoteToCode = (text: string) => {
  const matches = []
  const parts = []

  try {
    const supportedWord = '`[\\w$-?{} .]+`'
    const front = '[ >.(]'
    const back = '[ <.,)?]'
    const pattern = new RegExp(
      `(${front}${supportedWord}${back}|^${supportedWord}${back}|${front}${supportedWord}$|^${supportedWord}$)`,
      'dg'
    )

    let result
    while ((result = pattern.exec(text) as any) !== null) {
      if (!result.indices?.[0]) continue
      matches.push(result.indices?.[0])
    }

    if (matches.length === 1 && matches[0][1] - matches[0][0] === text.length) {
      return `<code>${text.slice(1, text.length - 1)}</code>`
    }

    for (let index = 0; index < matches.length; index++) {
      const previous = matches[index - 1]
      const matched = matches[index]
      parts.push(
        ...[
          text.slice(previous?.[1] - 1 ?? 0, matched[0] + 1),
          `<code>${text.slice(matched[0] + 2, matched[1] - 2)}</code>`
        ]
      )
    }

    if (matches.length) {
      const last = matches.pop()
      parts.push(text.slice(last?.[1] - 1))
      return parts.join('')
    }

    return text
  } catch {
    return text
  }
}
