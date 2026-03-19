import type { LambdaConfig } from '@/lib/services/email/lambda'
import type { ResendConfig } from '@/lib/services/email/resend'
import type { SMTPConfig } from '@/lib/services/email/smtp'

import { matcher } from './utils'

type EmailConfig = SMTPConfig | ResendConfig | LambdaConfig

const getSMTPConfig = () => ({
  host: process.env.ACTIVITIES_EMAIL_SMTP_HOST,
  port: process.env.ACTIVITIES_EMAIL_SMTP_PORT
    ? Number(process.env.ACTIVITIES_EMAIL_SMTP_PORT)
    : undefined,
  auth:
    process.env.ACTIVITIES_EMAIL_SMTP_USER ||
    process.env.ACTIVITIES_EMAIL_SMTP_PASSWORD
      ? {
          user: process.env.ACTIVITIES_EMAIL_SMTP_USER,
          pass: process.env.ACTIVITIES_EMAIL_SMTP_PASSWORD
        }
      : undefined,
  secure: process.env.ACTIVITIES_EMAIL_SMTP_SECURE
    ? process.env.ACTIVITIES_EMAIL_SMTP_SECURE === 'true'
    : undefined
})

const getResendConfig = () => ({
  token: process.env.ACTIVITIES_EMAIL_RESEND_TOKEN ?? ''
})

const getLambdaConfig = () => ({
  region: process.env.ACTIVITIES_EMAIL_LAMBDA_REGION ?? '',
  functionName: process.env.ACTIVITIES_EMAIL_LAMBDA_FUNCTION_NAME ?? '',
  functionQualifier:
    process.env.ACTIVITIES_EMAIL_LAMBDA_FUNCTION_QUALIFIER ?? ''
})

export const getEmailConfig = (): { email: EmailConfig } | null => {
  if (process.env.ACTIVITIES_EMAIL) {
    return { email: JSON.parse(process.env.ACTIVITIES_EMAIL) }
  }

  if (!matcher('ACTIVITIES_EMAIL_')) return null

  const type = process.env.ACTIVITIES_EMAIL_TYPE
  const serviceFromAddress = process.env.ACTIVITIES_EMAIL_FROM ?? ''

  switch (type) {
    case 'smtp':
      return { email: { type, serviceFromAddress, ...getSMTPConfig() } }
    case 'resend':
      return { email: { type, serviceFromAddress, ...getResendConfig() } }
    case 'lambda':
      return { email: { type, serviceFromAddress, ...getLambdaConfig() } }
    default:
      return null
  }
}
