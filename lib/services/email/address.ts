import type { Email } from '@/lib/config/email'

// A display name is written inside a quoted header string, so CR and LF would
// inject headers and `"` or `\` would end or escape the quoting. Domain names
// are admin text, so this is the one place every provider's From goes through.
const sanitizeName = (name: string) => name.replace(/[\r\n"\\]/g, '').trim()

export const getAddressFromEmail = (email: Email) => {
  if (typeof email === 'string') return email
  const name = sanitizeName(email.name)
  return name ? `"${name}" <${email.email}>` : email.email
}
