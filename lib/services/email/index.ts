import { getConfig } from '../../config'
import { TYPE_LAMBDA, sendLambdaMail } from './lambda'
import { TYPE_RESEND, sendResendMail } from './resend'
import { TYPE_SMTP, sendSMTPMail } from './smtp'
import { Message } from './types'

export const sendMail = async (message: Message) => {
  const { email } = getConfig()
  if (!email) return

  switch (email.type) {
    case TYPE_LAMBDA:
      return sendLambdaMail(message)
    case TYPE_SMTP:
      return sendSMTPMail(message)
    case TYPE_RESEND:
      return sendResendMail(message)
    default:
      throw new Error('Unsupported email type')
  }
}
