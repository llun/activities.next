import { z } from 'zod'

import { normalizeEmail } from '@/lib/utils/normalizeEmail'

// Request bodies of the Admin › Domains API.

export const AddDomainRequest = z.object({
  domain: z.string().trim().min(1).max(255)
})

export const UpdateDomainRequest = z
  .object({
    signupsOpen: z.boolean().optional(),
    allowedEmails: z
      .array(z.string().trim().max(255))
      .max(1000)
      .transform((emails) => emails.map(normalizeEmail).filter(Boolean))
      .optional(),
    allowExistingUsers: z.boolean().optional(),
    // Turning on or off is its own request: it is never mixed with the
    // Registrations box, so a failed check cannot drop a save.
    status: z.enum(['on', 'off']).optional()
  })
  .refine(
    (value) =>
      value.status === undefined ||
      (value.signupsOpen === undefined &&
        value.allowedEmails === undefined &&
        value.allowExistingUsers === undefined),
    { message: 'Send status on its own' }
  )
