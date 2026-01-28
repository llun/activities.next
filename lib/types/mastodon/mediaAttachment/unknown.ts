// This schema is base on https://docs.joinmastodon.org/entities/MediaAttachment/
import { z } from 'zod'

import { BaseMediaAttachment } from './base'

export const Unknown = BaseMediaAttachment.extend({
  type: z
    .literal('unknown')
    .describe(
      'The type of the attachment (unsupported or unrecognized file type)'
    )
})
export type Unknown = z.infer<typeof Unknown>
