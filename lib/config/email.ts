import type { LambdaConfig } from '@/lib/services/email/lambda'
import type { ResendConfig } from '@/lib/services/email/resend'
import type { SMTPConfig } from '@/lib/services/email/smtp'

import { logger } from '@/lib/utils/logger'

import { matcher } from './utils'

type EmailConfig = SMTPConfig | ResendConfig | LambdaConfig

const getSMTPConfig = () => {
  const portStr = process.env.ACTIVITIES_EMAIL_SMTP_PORT
  const portNum = portStr ? Number(portStr) : NaN
  const port =
    Number.isInteger(portNum) && portNum >= 0 && portNum <= 65535
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

const getLambdaConfig = () => ({
  ...(process.env.ACTIVITIES_EMAIL_LAMBDA_REGION
    ? { region: process.env.ACTIVITIES_EMAIL_LAMBDA_REGION }
    : {}),
  ...(process.env.ACTIVITIES_EMAIL_LAMBDA_FUNCTION_NAME
    ? { functionName: process.env.ACTIVITIES_EMAIL_LAMBDA_FUNCTION_NAME }
    : {}),
  ...(process.env.ACTIVITIES_EMAIL_LAMBDA_FUNCTION_QUALIFIER
    ? { functionQualifier: process.env.ACTIVITIES_EMAIL_LAMBDA_FUNCTION_QUALIFIER }
    : {})
})

export const getEmailConfig = (): { email: EmailConfig } | null => {
  if (process.env.ACTIVITIES_EMAIL) {
    try {
      return { email: JSON.parse(process.env.ACTIVITIES_EMAIL) }
    } catch {
      logger.warn(
        'ACTIVITIES_EMAIL contains malformed JSON; falling back to individual env vars'
      )
    }
  }

  if (!type) {
    logger.warn(
      'ACTIVITIES_EMAIL_TYPE is not set; email will be disabled'
    )
    return null
  }

  switch (type) {
    case 'smtp':
      return {
        email: {
          type,
          ...(serviceFromAddress ? { serviceFromAddress } : {}),
          ...getSMTPConfig()
        } as SMTPConfig
      }
    case 'resend':
      return {
        email: {
          type,
          ...(serviceFromAddress ? { serviceFromAddress } : {}),
          ...getResendConfig()
        } as ResendConfig
      }
    case 'lambda':
      return {
        email: {
          type,
          ...(serviceFromAddress ? { serviceFromAddress } : {}),
          ...getLambdaConfig()
        } as LambdaConfig
      }
    default:
      logger.warn(
        `Unknown ACTIVITIES_EMAIL_TYPE value "${type}"; email will be disabled`
      )
      return null
  }
}
