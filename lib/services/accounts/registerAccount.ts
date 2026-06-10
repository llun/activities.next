import * as bcrypt from 'bcrypt'
import crypto from 'crypto'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { sendMail } from '@/lib/services/email'
import { getLocalActorId } from '@/lib/utils/activitypubId'
import { logger } from '@/lib/utils/logger'
import { generateKeyPair } from '@/lib/utils/signature'

const BCRYPT_ROUND = 10

export type RegisterAccountResult =
  | { type: 'success'; accountId: string; username: string; actorId: string }
  | { type: 'registration_closed' }
  | { type: 'email_not_allowed' }
  | {
      type: 'validation_failed'
      details: Record<string, { error: string; description: string }[]>
    }

export interface RegisterAccountParams {
  database: Database
  username: string
  email: string
  password: string
  name?: string | null
}

export const registerAccount = async ({
  database,
  username,
  email,
  password,
  name
}: RegisterAccountParams): Promise<RegisterAccountResult> => {
  const config = getConfig()

  if (!config.registrationOpen) {
    return { type: 'registration_closed' }
  }

  const { host: domain, allowEmails } = config

  if (allowEmails.length && !allowEmails.includes(email)) {
    return { type: 'email_not_allowed' }
  }

  const [isAccountExists, isUsernameExists] = await Promise.all([
    database.isAccountExists({ email }),
    database.isUsernameExists({ username, domain })
  ])

  const errorDetails: Record<string, { error: string; description: string }[]> =
    {}

  if (isAccountExists) {
    errorDetails.email = [
      { error: 'ERR_TAKEN', description: 'Email is already taken' }
    ]
  }

  if (isUsernameExists) {
    errorDetails.username = [
      { error: 'ERR_TAKEN', description: 'Username is already taken' }
    ]
  }

  if (Object.keys(errorDetails).length > 0) {
    return { type: 'validation_failed', details: errorDetails }
  }

  const [keyPair, passwordHash] = await Promise.all([
    generateKeyPair(config.secretPhase),
    bcrypt.hash(password, BCRYPT_ROUND)
  ])

  const verificationCode = config.email
    ? crypto.randomBytes(32).toString('base64url')
    : null

  const accountId = await database.createAccount({
    domain,
    email,
    username,
    name: name || null,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    passwordHash,
    verificationCode
  })

  if (config.email) {
    try {
      await sendMail({
        from: config.email.serviceFromAddress,
        to: [email],
        subject: 'Email verification',
        content: {
          text: `Open this link to verify your email https://${config.host}/auth/confirmation?verificationCode=${verificationCode}`,
          html: `Open <a href="https://${config.host}/auth/confirmation?verificationCode=${verificationCode}">this link</a> to verify your email.`
        }
      })
    } catch {
      logger.error({ to: email }, `Fail to send email`)
    }
  }

  // createAccount derives the local actor id deterministically from
  // domain/username (getLocalActorId), so recompute it here instead of issuing
  // an extra lookup — it is guaranteed to match the actor just created and is
  // the id OAuthGuard resolves the request actor from.
  const actorId = getLocalActorId({ domain, username })

  return { type: 'success', accountId, username, actorId }
}
