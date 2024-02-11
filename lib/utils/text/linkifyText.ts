import * as linkify from 'linkifyjs'

import { linkBody } from './linkBody'
import './linkify-mention'
import { mentionBody } from './mentionBody'

export const linkifyText = (host: string) => (text: string) => {
  const tokens = linkify.tokenize(text)
  const texts = tokens.map((item) => {
    if (item.t === 'mention') {
      const mention = item.v
      const [username] = mention.slice(1).split('@')
      return mentionBody(`https://${host}/${mention}`, username)
    }

    if (item.t === 'url') {
      return linkBody(item.v)
    }

    return item.v
  })
  return texts.join('')
}
