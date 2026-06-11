import * as bcrypt from 'bcrypt'
import crypto from 'crypto'

import { getConfig } from '@/lib/config'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { Database } from '@/lib/database/types'
import { sendConfirmationEmail } from '@/lib/services/accounts/sendConfirmationEmail'
import { getLocalActorId } from '@/lib/utils/activitypubId'
import { logger } from '@/lib/utils/logger'
import { isEmailAllowed, normalizeEmail } from '@/lib/utils/normalizeEmail'
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
  email: rawEmail,
  password,
  name
}: RegisterAccountParams): Promise<RegisterAccountResult> => {
  const config = getConfig()

  if (!config.registrationOpen) {
    return { type: 'registration_closed' }
  }

  // Normalize once at the service boundary so the allow-list check, the
  // existence pre-checks, the DB insert, and the confirmation email all see the
  // same canonical (lowercased) address — even when this service is called
  // directly rather than through the request schema. See normalizeEmail.
  const email = normalizeEmail(rawEmail)
  const { host: domain, allowEmails } = config

  if (!isEmailAllowed(allowEmails, email)) {
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
      // createAccount inserts both an account (unique email) and an actor
      // (unique username+domain), so the collision can be on either field.
      // Re-run the existence checks to report the field(s) that are actually
      // taken rather than parsing backend-specific constraint text.
      const [emailTaken, usernameTaken] = await Promise.all([
        database.isAccountExists({ email }),
        database.isUsernameExists({ username, domain })
      ])
      const details: Record<string, { error: string; description: string }[]> =
        {}
      if (emailTaken) {
        details.email = [
          { error: 'ERR_TAKEN', description: 'Email is already taken' }
        ]
      }
      if (usernameTaken) {
        details.username = [
          { error: 'ERR_TAKEN', description: 'Username is already taken' }
        ]
      }
      // A constraint fired but neither lookup confirms a duplicate (an
      // unexpected unique column): fall back to a generic email collision so
      // the caller still gets a 422 rather than a 500.
      if (Object.keys(details).length === 0) {
        details.email = [
          { error: 'ERR_TAKEN', description: 'Email is already taken' }
        ]
      }
      return { type: 'validation_failed', details }
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
