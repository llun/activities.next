import { z } from 'zod'

import { NulFreeString } from '@/lib/services/fitness-files/queryParams'

export const SetRegionNameBody = z.object({
  // Looser raw cap than the 255-char cache-key column: clients may send
  // high-precision coordinates that normalizeRegion rounds + caps under 255.
  // No NUL check is needed here: the stored key is re-serialized from parsed
  // numbers, so a NUL in the raw value can only drop its token.
  region: z.string().max(1024),
  // The region label. Blank/whitespace/null clears the stored label. The DB
  // column is varchar(255); the UI input caps typing at 80. A NUL byte answers
  // 400 rather than reaching PostgreSQL, which rejects one with a 500.
  name: NulFreeString.max(255)
    .nullish()
    .transform((value) => value?.trim() || null)
})
