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

export const readRequestData = async (req: Request) => {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return req.json()
  }

  const formData = await req.formData()
  return Object.fromEntries(formData.entries())
}
