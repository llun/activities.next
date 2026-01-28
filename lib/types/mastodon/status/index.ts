// This schema is base on https://docs.joinmastodon.org/entities/Status/
import { z } from 'zod'

import { BaseStatus } from './base'

export const Status = BaseStatus.extend({
  reblog: BaseStatus.nullable().describe('The status being reblogged')
})
export type Status = z.infer<typeof Status>
