import { getConfig } from '@/lib/config'
import { TYPE_RESEND, TYPE_SES, TYPE_SMTP } from '@/lib/config/email'
import type { Message } from '@/lib/config/email'

export const sendMail = async (message: Message): Promise<void> => {
  const { email } = getConfig()
  if (!email) return

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
}
