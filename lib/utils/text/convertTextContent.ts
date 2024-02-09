import _ from 'lodash'
import sanitizeHtml from 'sanitize-html'

import { TagData } from '../../models/tag'
import { convertEmojisToImages } from './convertEmojisToImages'
import { convertMarkdownText } from './convertMarkdownText'
import { linkifyText } from './linkifyText'
import { SANITIZED_OPTION } from './sanitizeText'

export const convertTextContent = (text: string, tags: TagData[] = []) =>
  _.chain(text)
    .thru((text) => sanitizeHtml(text, SANITIZED_OPTION))
    .thru(convertMarkdownText)
    .thru(linkifyText)
    .thru(_.curryRight(convertEmojisToImages)(tags))
    .value()
    .trim()
