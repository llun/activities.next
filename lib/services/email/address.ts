import type { Email } from '@/lib/config/email'

export const getAddressFromEmail = (email: Email) =>
  typeof email === 'string' ? email : `"${email.name}" <${email.email}>`
