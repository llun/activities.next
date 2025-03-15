import crypto from 'crypto'

export const getHashFromString = (str: string) => {
  return crypto.createHash('sha256').update(str).digest('hex')
}
