import * as bcrypt from 'bcrypt'
import z from 'zod'

import { getConfig } from '../../../../lib/config'
import { errorResponse } from '../../../../lib/errors'
import { generateKeyPair } from '../../../../lib/signature'
import { getStorage } from '../../../../lib/storage'
import { ApiTrace } from '../../../../lib/trace'

const BCRYPT_ROUND = 10

export const NoteSchema = z.object({
  username: z.string(),
  email: z.string(),
  password: z.string()
})

export type NoteSchema = z.infer<typeof NoteSchema>

const handler = ApiTrace('v1/accounts/index', async (req, res) => {
  switch (req.method) {
    case 'POST': {
      const config = getConfig()
      const storage = await getStorage()
      if (!storage) {
        return errorResponse(res, 500)
      }

      const domain = config.host
      const content = NoteSchema.safeParse(req.body)
      if (!content.success) {
        const error = content.error
        const fields = error.flatten((issue) => ({
          error: 'ERR_INVALID',
          description: issue.message
        }))
        res.status(422).json({
          error: 'Validation failed',
          details: fields.fieldErrors
        })
        return
      }

      const form = content.data
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
        res.status(422).json({
          error: 'Validation failed',
          details: errorDetails
        })
        return
      }

      // TODO: If the request has auth bearer, return 200 instead
      const [keyPair, passwordHash] = await Promise.all([
        generateKeyPair(config.secretPhase),
        bcrypt.hash(form.password, BCRYPT_ROUND)
      ])

      await storage.createAccount({
        domain,
        email: form.email,
        username: form.username,
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        passwordHash
      })
      res.status(302).redirect('/auth/signin')
      return
    }
    default: {
      return errorResponse(res, 404)
    }
  }
})

export default handler
