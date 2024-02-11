import _ from 'lodash'

import { convertMarkdownText } from './convertMarkdownText'
import { sanitizeText } from './sanitizeText'

export const formatText = (host: string, text: string) =>
  _.chain(text)
    .thru(convertMarkdownText)
    .thru(sanitizeText(host))
    .value()
    .trim()
