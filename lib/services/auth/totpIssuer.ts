// What an authenticator app shows when no usable name is left.
export const DEFAULT_TOTP_ISSUER = 'Activities.next'

// C0 controls, DEL and C1 controls.
const isControlCharacter = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

/**
 * The issuer label of a TOTP `otpauth://` URI, from a server or domain name.
 * The Key URI format forbids a colon in the issuer (it separates the issuer
 * from the account in the label), and a control character in an admin-set
 * name would only garble the authenticator entry, so both become spaces and
 * the whitespace is collapsed. Falls back to `DEFAULT_TOTP_ISSUER` when
 * nothing remains.
 */
export const toTotpIssuer = (name: string): string =>
  Array.from(name, (character) =>
    character === ':' || isControlCharacter(character) ? ' ' : character
  )
    .join('')
    .replace(/\s+/g, ' ')
    .trim() || DEFAULT_TOTP_ISSUER
