import { z } from 'zod'

import { Emoji } from './emoji'
import { HashTag } from './hashtag'
import { Mention } from './mention'

export const Tag = z.union([Mention, Emoji, HashTag])
export type Tag = z.infer<typeof Tag>
