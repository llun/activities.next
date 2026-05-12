import { z } from 'zod'

import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/activitypub'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { getTracer } from '@/lib/utils/trace'

const PublicKeyDocument = z
  .object({
    id: z.string(),
    owner: z.string(),
    publicKeyPem: z.string()
  })
  .passthrough()

export type SenderPublicKeyDetails = {
  owner: string | null
  publicKey: string
}

type ParsedSenderPublicKey =
  | {
      type: 'actor'
      actorId: string
      keyId: string
      requiresOwnerValidation: boolean
      details: SenderPublicKeyDetails
    }
  | {
      type: 'publicKey'
      keyId: string
      details: SenderPublicKeyDetails
    }

const EMPTY_PUBLIC_KEY_DETAILS: SenderPublicKeyDetails = {
  owner: null,
  publicKey: ''
}

const getLocalSenderPublicKeyDetails = async (
  database: Database,
  actorId: string
) => {
  const localActor = await database.getActorFromId({ id: actorId })
  if (localActor) {
    return {
      owner: localActor.id,
      publicKey: localActor.publicKey
    }
  }

  const actorIdWithoutFragment = normalizeActorId(actorId)
  if (!actorIdWithoutFragment || actorIdWithoutFragment === actorId) {
    return null
  }

  const fragmentLocalActor = await database.getActorFromId({
    id: actorIdWithoutFragment
  })
  if (!fragmentLocalActor) return null

  return {
    owner: fragmentLocalActor.id,
    publicKey: fragmentLocalActor.publicKey
  }
}

const parseJsonBody = ({
  body,
  actorId
}: {
  body: string
  actorId: string
}) => {
  try {
    return JSON.parse(body) as unknown
  } catch (error) {
    logger.warn({
      actorId,
      err: error as Error,
      message: 'Unable to parse sender public key response'
    })
    return null
  }
}

const parseSenderPublicKey = ({
  body,
  keyId
}: {
  body: string
  keyId: string
}): ParsedSenderPublicKey | null => {
  const json = parseJsonBody({ body, actorId: keyId })
  if (!json) return null

  const actor = Actor.safeParse(json)
  if (actor.success) {
    if (actor.data.id !== keyId && actor.data.publicKey.id !== keyId) {
      return null
    }
    if (actor.data.publicKey.owner !== actor.data.id) {
      return null
    }

    return {
      type: 'actor',
      actorId: actor.data.id,
      keyId: actor.data.publicKey.id,
      requiresOwnerValidation: actor.data.id !== keyId,
      details: {
        owner: actor.data.id,
        publicKey: actor.data.publicKey.publicKeyPem
      }
    }
  }

  const publicKeyDocument = PublicKeyDocument.safeParse(json)
  if (!publicKeyDocument.success) return null
  if (publicKeyDocument.data.id !== keyId) return null

  return {
    type: 'publicKey',
    keyId: publicKeyDocument.data.id,
    details: {
      owner: publicKeyDocument.data.owner,
      publicKey: publicKeyDocument.data.publicKeyPem
    }
  }
}

const fetchSenderPublicKey = async (
  actorId: string,
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>
) => {
  const response = await request({
    url: actorId,
    headers: activityPubRequestHeaders({
      url: actorId,
      signingActor
    })
  })
  if (response.statusCode !== 200) {
    return {
      document: null,
      statusCode: response.statusCode
    }
  }

  return {
    document: parseSenderPublicKey({
      body: response.body,
      keyId: actorId
    }),
    statusCode: response.statusCode
  }
}

const validateOwnerActorKey = async (
  {
    keyId,
    owner,
    publicKey
  }: {
    keyId: string
    owner: string | null
    publicKey: string
  },
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>
) => {
  if (!owner) return null

  const ownerResponse = await fetchSenderPublicKey(owner, signingActor)
  if (ownerResponse.statusCode !== 200) return null
  if (ownerResponse.document?.type !== 'actor') return null

  const ownerDocument = ownerResponse.document
  if (ownerDocument.actorId !== owner) return null
  if (ownerDocument.keyId !== keyId) return null
  if (ownerDocument.details.publicKey !== publicKey) {
    return null
  }

  return {
    owner: ownerDocument.actorId,
    publicKey
  }
}

const resolveFetchedPublicKey = async (
  document: ParsedSenderPublicKey | null,
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>
) => {
  if (!document) return null
  if (document.type === 'actor') {
    if (!document.requiresOwnerValidation) return document.details
    return validateOwnerActorKey(
      {
        keyId: document.keyId,
        owner: document.actorId,
        publicKey: document.details.publicKey
      },
      signingActor
    )
  }

  return validateOwnerActorKey(
    {
      keyId: document.keyId,
      owner: document.details.owner,
      publicKey: document.details.publicKey
    },
    signingActor
  )
}

const fetchSenderPublicKeyDetails = async (
  actorId: string,
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>
) => {
  const response = await fetchSenderPublicKey(actorId, signingActor)
  return {
    details: await resolveFetchedPublicKey(response.document, signingActor),
    statusCode: response.statusCode
  }
}

const resolveSenderPublicKeyDetails = async (
  database: Database,
  actorId: string
) => {
  const localPublicKey = await getLocalSenderPublicKeyDetails(database, actorId)
  if (localPublicKey) return localPublicKey

  const signingActor = await getFederationSigningActor(database)
  const response = await fetchSenderPublicKeyDetails(actorId, signingActor)
  if (response.details) return response.details

  if (response.statusCode === 410) {
    const url = new URL(actorId)
    const fallbackResponse = await fetchSenderPublicKeyDetails(
      `${url.protocol}//${url.host}/actor#main-key`,
      signingActor
    )
    return fallbackResponse.details ?? EMPTY_PUBLIC_KEY_DETAILS
  }

  return EMPTY_PUBLIC_KEY_DETAILS
}

export async function getSenderPublicKeyDetails(
  database: Database,
  actorId: string
): Promise<SenderPublicKeyDetails> {
  const tracer = getTracer()
  return tracer.startActiveSpan(
    'guard.getSenderPublicKey',
    { attributes: { actorId } },
    async (span) => {
      try {
        return await resolveSenderPublicKeyDetails(database, actorId)
      } catch (error) {
        const nodeError = error as Error
        span.recordException(nodeError)
        logger.warn({
          actorId,
          err: nodeError,
          message: 'Unable to resolve sender public key'
        })
        return EMPTY_PUBLIC_KEY_DETAILS
      } finally {
        span.end()
      }
    }
  )
}

export async function getSenderPublicKey(database: Database, actorId: string) {
  const sender = await getSenderPublicKeyDetails(database, actorId)
  return sender.publicKey
}
