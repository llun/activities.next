import * as bcrypt from 'bcrypt'
import crypto from 'crypto'

import { getConfig } from '@/lib/config'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { Database } from '@/lib/database/types'
import { sendConfirmationEmail } from '@/lib/services/accounts/sendConfirmationEmail'
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

  // The isAccountExists/isUsernameExists pre-checks above resolve the common
  // case with field-specific 422s, but two concurrent registrations can still
  // race past them and collide on the DB unique constraint. Map that collision
  // back to the same validation_failed result instead of letting it surface as
  // a 500.
  let accountId: string
  try {
    accountId = await database.createAccount({
      domain,
      email,
      username,
      name: name || null,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      passwordHash,
      verificationCode
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        type: 'validation_failed',
        details: {
          email: [{ error: 'ERR_TAKEN', description: 'Email is already taken' }]
        }
      }
    }
    throw error
  }

  if (verificationCode) {
    try {
      await sendConfirmationEmail({ recipient: email, verificationCode })
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
