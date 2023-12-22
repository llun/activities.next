import * as bcrypt from 'bcrypt'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getConfig } from '../../../../lib/config'
import { ERROR_500 } from '../../../../lib/errors'
import { sendMail } from '../../../../lib/services/email'
import { generateKeyPair } from '../../../../lib/signature'
import { getStorage } from '../../../../lib/storage'
import { CreateAccountRequest } from './types'

const BCRYPT_ROUND = 10
const MAIN_ERROR_MESSAGE = 'Validation failed'

export const POST = async (request: NextRequest) => {
  const config = getConfig()
  const storage = await getStorage()
  if (!storage) {
    return Response.json(ERROR_500, { status: 500 })
  }

  const { host: domain, allowEmails } = config
  const body = await request.json()
  const content = CreateAccountRequest.safeParse(body)
  if (!content.success) {
    const error = content.error
    const fields = error.flatten((issue) => ({
      error: 'ERR_INVALID',
      description: issue.message
    }))
    return Response.json(
      {
        error: MAIN_ERROR_MESSAGE,
        details: fields.fieldErrors
      },
      { status: 422 }
    )
  }

  const form = content.data
  if (allowEmails.length && !allowEmails.includes(form.email)) {
    return Response.json(
      {
        error: MAIN_ERROR_MESSAGE,
        details: {
          email: [{ error: 'ERR_TAKEN', description: 'Email is already taken' }]
        }
      },
      { status: 422 }
    )
  }

  const [isAccountExists, isUsernameExists] = await Promise.all([
    storage.isAccountExists({ email: form.email }),
    storage.isUsernameExists({ username: form.username, domain })
  ])

  const errorDetails: {
    [key in 'email' | 'username']?: { error: string; description: string }[]
  } = {}
  if (isAccountExists) {
    errorDetails.email = [
      {
        error: 'ERR_TAKEN',
        description: 'Email is already taken'
      }
    ]
  }

  if (isUsernameExists) {
    errorDetails.username = [
      {
        error: 'ERR_TAKEN',
        description: 'Username is already taken'
      }
    ]
  }
  if (Object.keys(errorDetails).length > 0) {
    return Response.json(
      {
        error: MAIN_ERROR_MESSAGE,
        details: errorDetails
      },
      { status: 422 }
    )
  }

  // TODO: If the request has auth bearer, return 200 instead
  const [keyPair, passwordHash] = await Promise.all([
    generateKeyPair(config.secretPhase),
    bcrypt.hash(form.password, BCRYPT_ROUND)
  ])

  const verificationCode = config.email
    ? crypto.randomBytes(32).toString('base64url')
    : null

  await storage.createAccount({
    domain,
    email: form.email,
    username: form.username,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    passwordHash,
    verificationCode
  })

  if (config.email) {
    try {
      await sendMail({
        from: config.email.serviceFromAddress,
        to: [form.email],
        subject: 'Email verification',
        content: {
          text: `Open this link to verify your email https://${config.host}/auth/confirmation?verificationCode=${verificationCode}`,
          html: `Open <a href="https://${config.host}/auth/confirmation?verificationCode=${verificationCode}">this link</a> to verify your email.`
        }
      })
    } catch {
      console.error(`Fail to send email to ${form.email}`)
    }
  }

  return Response.redirect('/auth/signin', 307)
}
