import { z } from 'zod'

import { normalizeDomain } from '@/lib/services/federation/domainRules'
import { DomainBlockSeverity } from '@/lib/types/database/operations'

const Booleanish = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === 'boolean') return value
  const normalized = value.toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'on'
})

const Comment = z.string().trim().max(10_000)
const CreateComment = Comment.optional().transform((value) => value || null)
const UpdateComment = Comment.transform((value) => value || null).optional()

export const DomainBlockRequest = z.object({
  domain: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => normalizeDomain(value) !== null),
  // Mastodon's DomainBlock model defaults to silence; suspend is opt-in.
  severity: DomainBlockSeverity.default('silence'),
  reject_media: Booleanish.default(false),
  reject_reports: Booleanish.default(false),
  private_comment: CreateComment,
  public_comment: CreateComment,
  obfuscate: Booleanish.default(false)
})

export const DomainBlockUpdateRequest = z.object({
  severity: DomainBlockSeverity.optional(),
  reject_media: Booleanish.optional(),
  reject_reports: Booleanish.optional(),
  private_comment: UpdateComment,
  public_comment: UpdateComment,
  obfuscate: Booleanish.optional()
})
