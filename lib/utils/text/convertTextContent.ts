import _ from 'lodash'

import { TagData } from '../../models/tag'
import { convertEmojisToImages } from './convertEmojisToImages'
import { convertQuoteToCode } from './convertQuoteToCode'

export const convertTextContent = (text: string, tags: TagData[]) =>
  _.chain(text)
    .thru(convertQuoteToCode)
    .thru(_.curryRight(convertEmojisToImages)(tags))
    .value()
