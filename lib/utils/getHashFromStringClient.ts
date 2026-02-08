const encoder = new TextEncoder()

export const getHashFromStringClient = async (str: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(str))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
