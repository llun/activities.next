import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

import { matcher } from './utils'

export const TYPE_SMTP = 'smtp' as const
export const TYPE_RESEND = 'resend' as const
export const TYPE_SES = 'ses' as const

const SUPPORTED_EMAIL_TYPES = [TYPE_SMTP, TYPE_RESEND, TYPE_SES] as const

/**
 * The address and message schemas live with runtime configuration so loading
 * config never needs to import one of the provider implementations.
 */
export const Email = z.union([
  z.string(),
  z.object({ name: z.string(), email: z.string() })
])
export type Email = z.infer<typeof Email>

export const Message = z.object({
  from: Email,
  to: Email.array(),
  replyTo: Email.optional(),
  subject: z.string(),
  content: z.object({
    text: z.string(),
    html: z.string()
  })
})
export type Message = z.infer<typeof Message>

export const BaseEmailSettings = z.object({
  serviceFromAddress: z.string()
})
export type BaseEmailSettings = z.infer<typeof BaseEmailSettings>

export const SMTPConfig = z.looseObject({
  ...BaseEmailSettings.shape,
  type: z.literal(TYPE_SMTP)
})
export type SMTPConfig = z.infer<typeof SMTPConfig> & SMTPTransport.Options

export const ResendConfig = BaseEmailSettings.extend({
  type: z.literal(TYPE_RESEND),
  token: z.string()
})
export type ResendConfig = z.infer<typeof ResendConfig>

export const SESConfig = BaseEmailSettings.extend({
  type: z.literal(TYPE_SES),
  region: z.string().optional()
})
export type SESConfig = z.infer<typeof SESConfig>

export const EmailConfig = z.union([SMTPConfig, ResendConfig, SESConfig])
export type EmailConfig = z.infer<typeof EmailConfig>

/** Raised before Config.parse can turn an explicitly unsupported provider into no email. */
export class UnsupportedEmailProviderError extends Error {
  readonly provider: string

  constructor(provider: string) {
    super(
      `Unsupported email provider "${provider}"; supported providers are smtp, resend, and ses`
    )
    this.name = 'UnsupportedEmailProviderError'
    this.provider = provider
  }
}

const rejectUnsupportedEmailType = (value: unknown): void => {
  if (
    typeof value === 'string' &&
    !(SUPPORTED_EMAIL_TYPES as readonly string[]).includes(value)
  ) {
    throw new UnsupportedEmailProviderError(value)
  }
}

const getSMTPConfig = () => {
  const portStr = process.env.ACTIVITIES_EMAIL_SMTP_PORT
  const portNum = portStr ? Number(portStr) : NaN
  const port =
    Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535
      ? portNum
      : undefined

  return {
    ...(process.env.ACTIVITIES_EMAIL_SMTP_HOST
      ? { host: process.env.ACTIVITIES_EMAIL_SMTP_HOST }
      : {}),
    ...(port !== undefined ? { port } : {}),
    ...(process.env.ACTIVITIES_EMAIL_SMTP_USER &&
    process.env.ACTIVITIES_EMAIL_SMTP_PASSWORD
      ? {
          auth: {
            user: process.env.ACTIVITIES_EMAIL_SMTP_USER,
            pass: process.env.ACTIVITIES_EMAIL_SMTP_PASSWORD
          }
        }
      : {}),
    ...(process.env.ACTIVITIES_EMAIL_SMTP_SECURE
      ? { secure: process.env.ACTIVITIES_EMAIL_SMTP_SECURE === 'true' }
      : {})
  }
}

const getResendConfig = () => ({
  ...(process.env.ACTIVITIES_EMAIL_RESEND_TOKEN
    ? { token: process.env.ACTIVITIES_EMAIL_RESEND_TOKEN }
    : {})
})

const getSESConfig = () => ({
  ...(process.env.ACTIVITIES_EMAIL_SES_REGION
    ? { region: process.env.ACTIVITIES_EMAIL_SES_REGION }
    : {})
})

export const getEmailConfig = (): { email: EmailConfig } | null => {
  if (process.env.ACTIVITIES_EMAIL) {
    try {
      const email = JSON.parse(process.env.ACTIVITIES_EMAIL) as {
        type?: unknown
      }
      rejectUnsupportedEmailType(email?.type)
      return { email: email as EmailConfig }
    } catch (error) {
      if (error instanceof UnsupportedEmailProviderError) throw error

      logger.warn(
        'ACTIVITIES_EMAIL contains malformed JSON; falling back to individual env vars'
      )
    }
  }

  if (!matcher('ACTIVITIES_EMAIL_')) return null

  const type = process.env.ACTIVITIES_EMAIL_TYPE
  const serviceFromAddress = process.env.ACTIVITIES_EMAIL_FROM

  if (!type) {
    throw new Error(
      'ACTIVITIES_EMAIL_TYPE is not set; email configuration is invalid'
    )
  }

  rejectUnsupportedEmailType(type)

  switch (type) {
    case TYPE_SMTP:
      return {
        email: {
          type,
          ...(serviceFromAddress ? { serviceFromAddress } : {}),
          ...getSMTPConfig()
        } as SMTPConfig
      }
    case TYPE_RESEND:
      return {
        email: {
          type,
          ...(serviceFromAddress ? { serviceFromAddress } : {}),
          ...getResendConfig()
        } as ResendConfig
      }
    case TYPE_SES:
      return {
        email: {
          type,
          ...(serviceFromAddress ? { serviceFromAddress } : {}),
          ...getSESConfig()
        } as SESConfig
      }
  }

  throw new Error(`Unsupported email provider "${type}"`)
}
