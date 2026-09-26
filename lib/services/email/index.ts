import { getConfig } from '@/lib/config'
import { TYPE_RESEND, TYPE_SES, TYPE_SMTP } from '@/lib/config/email'
import type { Message } from '@/lib/config/email'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export const isMissingModuleError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string; message?: string }
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
    return true
  }
  if (typeof err.message === 'string') {
    return (
      err.message.includes('Cannot find package') ||
      err.message.includes('Cannot find module') ||
      err.message.includes('ERR_MODULE_NOT_FOUND') ||
      err.message.includes('MODULE_NOT_FOUND')
    )
  }
  return false
}

export const sendMail = async (message: Message): Promise<void> => {
  const { email } = getConfig()
  if (!email) return

  try {
    switch (email.type) {
      case TYPE_SMTP: {
        const { sendSMTPMail } = await import('./smtp')
        await sendSMTPMail(message, email)
        return
      }
      case TYPE_RESEND: {
        const { sendResendMail } = await import('./resend')
        await sendResendMail(message, email)
        return
      }
      case TYPE_SES: {
        const { sendSESMail } = await import('./ses')
        await sendSESMail(message, email)
        return
      }
      default: {
        const type = (email as { type: string }).type
        throw new Error(`Unsupported email type "${type}"`)
      }
    }
  } catch (error) {
    if (isMissingModuleError(error)) {
      logger.warn({
        message: `Email provider "${email.type}" dependency is not installed; email delivery is disabled`,
        err: toLoggableError(error)
      })
      return
    }
    throw error
  }
}
