import crypto from 'crypto'

export const hashPasswordResetCode = (passwordResetCode: string): string =>
  crypto.createHash('sha256').update(passwordResetCode).digest('hex')
