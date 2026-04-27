import { z } from 'zod'

import { normalizeDomain } from '@/lib/services/federation/domainRules'

export const DomainAllowRequest = z.object({
  domain: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => normalizeDomain(value) !== null)
})
