import _ from 'lodash'

import { Status, StatusType } from '@/lib/models/status'
import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

/**
 * Helper function to get the actual status from a boosted status
 * @param status Status that might be a boosted status
 * @returns The actual status content
 */
export const getActualStatus = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Announce:
      return status.originalStatus
    default:
      return status
  }
}

/**
 * Process status text with proper formatting and sanitization for React components
 * This function encapsulates the text processing logic used in the Post component
 *
 * @param host Server host for converting markdown text
 * @param status Status object that contains the text to process
 * @returns Processed text as string for use in React components
 */
export const processStatusText = (host: string, status: Status) => {
  const actualStatus = getActualStatus(status)

  return _.chain(actualStatus.text)
    .thru(actualStatus.isLocalActor ? convertMarkdownText(host) : sanitizeText)
    .thru(_.curryRight(convertEmojisToImages)(actualStatus.tags))
    .thru(_.trim)
    .value()
}
