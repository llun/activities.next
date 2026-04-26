import { z } from 'zod'

import { normalizeDomain } from '@/lib/services/federation/domainRules'
import { DomainBlockSeverity } from '@/lib/types/database/operations'

const Booleanish = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === 'boolean') return value
  const normalized = value.toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'on'
})

export const DomainBlockRequest = z.object({
  domain: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => normalizeDomain(value) !== null),
  severity: DomainBlockSeverity.default('suspend'),
  reject_media: Booleanish.default(false),
  reject_reports: Booleanish.default(false),
  private_comment: z
    .string()
    .trim()
    .max(10_000)
    .optional()
    .transform((value) => value || null),
  public_comment: z
    .string()
    .trim()
    .max(10_000)
    .optional()
    .transform((value) => value || null),
  obfuscate: Booleanish.default(false)
})

export const DomainBlockUpdateRequest = DomainBlockRequest.omit({
  domain: true
}).partial()
