import * as bcrypt from 'bcrypt'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { sendMail } from '@/lib/services/email'
import { getRedirectUrl } from '@/lib/services/guards/getRedirectUrl'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { generateKeyPair } from '@/lib/utils/signature'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { CreateAccountRequest } from './types'

const BCRYPT_ROUND = 10
const MAIN_ERROR_MESSAGE = 'Validation failed'
const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'createAccount',
  async (request: NextRequest) => {
    const config = getConfig()
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const { host: domain, allowEmails } = config
    const body = await request.formData()
    const content = CreateAccountRequest.safeParse(
      body
        .entries()
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
    )
    if (!content.success) {
      const error = content.error
      const fields = error.flatten((issue) => ({
        error: 'ERR_INVALID',
        description: issue.message
      }))
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: MAIN_ERROR_MESSAGE, details: fields },
        responseStatusCode: 422
      })
    }

    const form = content.data
    if (allowEmails.length && !allowEmails.includes(form.email)) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: {
          error: MAIN_ERROR_MESSAGE,
          details: {
            email: [
              { error: 'ERR_TAKEN', description: 'Email is already taken' }
            ]
          }
        },
        responseStatusCode: 422
      })
    }

    const [isAccountExists, isUsernameExists] = await Promise.all([
      database.isAccountExists({ email: form.email }),
      database.isUsernameExists({ username: form.username, domain })
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
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: MAIN_ERROR_MESSAGE, details: errorDetails },
        responseStatusCode: 422
      })
    }

    // TODO: If the request has auth bearer, return 200 instead
    const [keyPair, passwordHash] = await Promise.all([
      generateKeyPair(config.secretPhase),
      bcrypt.hash(form.password, BCRYPT_ROUND)
    ])

    const verificationCode = config.email
      ? crypto.randomBytes(32).toString('base64url')
      : null

    await database.createAccount({
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
        logger.error({ to: form.email }, `Fail to send email`)
      }
    }

    return Response.redirect(getRedirectUrl(request, '/auth/signin'), 307)
  }
)
