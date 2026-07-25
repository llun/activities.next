import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

import { matcher } from './utils'

// Inbound email (reply-by-email). An email provider that receives mail for
// `domain` POSTs each message to /api/v1/webhooks/email, signed with `secret`.
// The feature is only live when this config AND `config.email` are both
// present — the outbound half mints the reply address, the inbound half
// accepts the answer.

export const DEFAULT_EMAIL_INBOUND_LOCAL_PART_PREFIX = 'reply'

// The prefix becomes the local part of a real address
// (`<prefix>+<token>@<domain>`), so restrict it to unquoted-atom characters.
// Anything else would have to be quoted to stay a legal address, and quoting a
// value an operator typed by mistake is worse than falling back to the default.
const LOCAL_PART_PREFIX_PATTERN = /^[A-Za-z0-9._-]+$/
// Deliberately permissive: a hostname's labels, no scheme, no path, no user
// part. It only has to be good enough to catch a pasted URL or a typo'd
// address, not to validate DNS.
const DOMAIN_PATTERN =
  /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/

export const EmailInboundConfig = z.object({
  // HMAC secret the provider signs its webhook payloads with.
  secret: z.string().min(1),
  // The domain that receives replies, e.g. `reply.example.tld`. Needs an MX
  // record pointing at whichever provider POSTs the webhook.
  domain: z.string().min(1),
  localPartPrefix: z.string().min(1)
})
export type EmailInboundConfig = z.infer<typeof EmailInboundConfig>

const getLocalPartPrefix = (): string => {
  const configured = process.env.ACTIVITIES_EMAIL_INBOUND_LOCAL_PART_PREFIX
  if (!configured) return DEFAULT_EMAIL_INBOUND_LOCAL_PART_PREFIX
  if (!LOCAL_PART_PREFIX_PATTERN.test(configured)) {
    logger.warn(
      `ACTIVITIES_EMAIL_INBOUND_LOCAL_PART_PREFIX "${configured}" is not a valid email local part; using "${DEFAULT_EMAIL_INBOUND_LOCAL_PART_PREFIX}"`
    )
    return DEFAULT_EMAIL_INBOUND_LOCAL_PART_PREFIX
  }
  return configured
}

export const getEmailInboundConfig = (): {
  emailInbound: EmailInboundConfig
} | null => {
  if (!matcher('ACTIVITIES_EMAIL_INBOUND_')) return null

  const secret = process.env.ACTIVITIES_EMAIL_INBOUND_SECRET
  const domain = process.env.ACTIVITIES_EMAIL_INBOUND_DOMAIN

  // Both halves are load-bearing: without the secret the webhook cannot be
  // authenticated, and without the domain no reply address can be minted.
  // Missing either one disables the feature rather than half-enabling it.
  if (!secret || !domain) {
    logger.warn(
      'ACTIVITIES_EMAIL_INBOUND_SECRET and ACTIVITIES_EMAIL_INBOUND_DOMAIN are both required; reply by email will be disabled'
    )
    return null
  }

  if (!DOMAIN_PATTERN.test(domain)) {
    logger.warn(
      `ACTIVITIES_EMAIL_INBOUND_DOMAIN "${domain}" is not a bare domain name; reply by email will be disabled`
    )
    return null
  }

  return {
    emailInbound: {
      secret,
      domain,
      localPartPrefix: getLocalPartPrefix()
    }
  }
}
