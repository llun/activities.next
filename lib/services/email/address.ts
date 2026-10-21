import type { Email } from '@/lib/config/email'

// A display name is written inside a quoted header string, so CR and LF would
// inject headers and `"` or `\` would end or escape the quoting. Domain names
// are admin text, so this is the one place every provider's From goes through.
// Every other control character (C0, DEL, C1, U+2028/U+2029) is not allowed
// in a header either: it becomes a space, and runs of whitespace collapse.
const sanitizeName = (name: string) =>
  name
    .replace(/["\\]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const isPrintableASCII = (value: string) => /^[\x20-\x7e]*$/.test(value)

// An RFC 2047 encoded-word is at most 75 characters: `=?UTF-8?B?` + `?=` is
// 12, leaving 63 of base64, i.e. 45 bytes. A word is cut on code point
// boundaries so no multi-byte character is split across two words.
const MAX_WORD_BYTES = 45

const encodeWords = (name: string): string => {
  const words: string[] = []
  let current: number[] = []
  for (const char of name) {
    const bytes = Array.from(Buffer.from(char, 'utf8'))
    if (current.length + bytes.length > MAX_WORD_BYTES) {
      words.push(Buffer.from(current).toString('base64'))
      current = []
    }
    current.push(...bytes)
  }
  if (current.length > 0) words.push(Buffer.from(current).toString('base64'))
  return words.map((word) => `=?UTF-8?B?${word}?=`).join(' ')
}

interface AddressOptions {
  /**
   * Write a non-ASCII display name as RFC 2047 encoded-words. For providers
   * that take the raw header string and need 7-bit ASCII (SES). Not for
   * nodemailer, which encodes names itself and would quote an encoded-word.
   */
  encodeName?: boolean
}

export const getAddressFromEmail = (
  email: Email,
  { encodeName = false }: AddressOptions = {}
) => {
  if (typeof email === 'string') return email
  const name = sanitizeName(email.name)
  if (!name) return email.email
  if (encodeName && !isPrintableASCII(name)) {
    return `${encodeWords(name)} <${email.email}>`
  }
  return `"${name}" <${email.email}>`
}
