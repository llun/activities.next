import _ from 'lodash'

import { Status, getOriginalStatus } from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'
import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import {
  sanitizeText,
  sanitizeTrustedStatusText
} from '@/lib/utils/text/sanitizeText'

/**
 * Helper function to get the actual status from a boosted status
 * @param status Status that might be a boosted status
 * @returns The actual status content
 */
export const getActualStatus = (status: Status) => {
  return getOriginalStatus(status)
}

/**
 * Process status text with proper formatting and sanitization for React components
 * This function encapsulates the text processing logic used in the Post component
 *
 * @param host Server host for converting markdown text
 * @param status Status object that contains the text to process
 * @returns Processed text as string for use in React components
 */
/**
 * Core text-processing pipeline shared by the rendered Post and the composer
 * live preview, so custom emoji (and markdown/sanitization) render identically
 * in both. Exposed separately from `processStatusText` so callers that have a
 * raw text + tag list (e.g. the postbox preview) can reuse the exact same
 * pipeline instead of introducing a second rendering path.
 */
export const processStatusTextContent = (
  host: string,
  text: string,
  tags: Tag[],
  isLocalActor: boolean
) =>
  _.chain(text)
    .thru(isLocalActor ? convertMarkdownText(host) : _.identity)
    .thru(sanitizeText)
    .thru(_.curryRight(convertEmojisToImages)(tags))
    .thru(sanitizeTrustedStatusText)
    .thru(_.trim)
    .value()

export const processStatusText = (host: string, status: Status) => {
  const actualStatus = getActualStatus(status)

  return processStatusTextContent(
    host,
    actualStatus.text,
    actualStatus.tags,
    actualStatus.isLocalActor
  )
}
