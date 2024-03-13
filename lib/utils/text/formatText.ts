import _ from 'lodash'

import { convertMarkdownText } from './convertMarkdownText'

export const formatText = (host: string, text: string) =>
  _.chain(text).thru(convertMarkdownText).value().trim()
