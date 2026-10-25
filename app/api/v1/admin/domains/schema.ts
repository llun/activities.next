import { z } from 'zod'

import { ADMIN_DOMAIN_FIELD_LIMITS } from '@/lib/services/domains/adminDomainTypes'
import { DOMAIN_FEATURES } from '@/lib/services/domains/domainFeatures'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

// Request bodies of the Admin › Served domains API.

export const AddDomainRequest = z.object({
  domain: z.string().trim().min(1).max(255)
})

// An identity or policy override: trimmed text, or null for "Same as server".
// Blank text is refused rather than read as null, so a cleared field the
// client forgot to switch back to "Same as server" is not saved silently.
const override = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional()

const IDENTITY_AND_POLICY_KEYS = [
  'name',
  'description',
  'contactEmail',
  'termsOfService',
  'privacyPolicy'
] as const

export const UpdateDomainRequest = z
  .object({
    signupsOpen: z.boolean().optional(),
    allowedEmails: z
      .array(z.string().trim().max(255))
      .max(1000)
      .transform((emails) => emails.map(normalizeEmail).filter(Boolean))
      .optional(),
    allowExistingUsers: z.boolean().optional(),
    // The features this domain turns off (the Features box): the whole list,
    // [] or null for none.
    // Repeated values collapse before the length check, not into a 422.
    disabledFeatures: z
      .preprocess(
        (value) => (Array.isArray(value) ? [...new Set(value)] : value),
        z.array(z.enum(DOMAIN_FEATURES)).max(DOMAIN_FEATURES.length)
      )
      .nullable()
      .optional()
      .transform((features) =>
        features
          ? DOMAIN_FEATURES.filter((f) => features.includes(f))
          : features
      ),
    name: override(ADMIN_DOMAIN_FIELD_LIMITS.name),
    description: override(ADMIN_DOMAIN_FIELD_LIMITS.description),
    contactEmail: z
      .string()
      .trim()
      .email()
      .max(ADMIN_DOMAIN_FIELD_LIMITS.contactEmail)
      .nullable()
      .optional(),
    termsOfService: override(ADMIN_DOMAIN_FIELD_LIMITS.termsOfService),
    privacyPolicy: override(ADMIN_DOMAIN_FIELD_LIMITS.privacyPolicy),
    // Turning on or off is its own request: it is never mixed with the
    // settings boxes, so a failed check cannot drop a save.
    status: z.enum(['on', 'off']).optional()
  })
  .refine(
    (value) =>
      value.status === undefined ||
      (value.signupsOpen === undefined &&
        value.allowedEmails === undefined &&
        value.allowExistingUsers === undefined &&
        value.disabledFeatures === undefined &&
        IDENTITY_AND_POLICY_KEYS.every((key) => value[key] === undefined)),
    { message: 'Send status on its own' }
  )

/** Whether a parsed body changes any identity or policy field. */
export const hasIdentityOrPolicyFields = (
  value: z.infer<typeof UpdateDomainRequest>
): boolean => IDENTITY_AND_POLICY_KEYS.some((key) => value[key] !== undefined)
