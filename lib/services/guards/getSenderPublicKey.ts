import { z } from 'zod'

import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/activitypub'
import {
  normalizeActivityPubUri,
  normalizeActorId
} from '@/lib/utils/activitypub'
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

const parseJsonBody = ({ body, keyId }: { body: string; keyId: string }) => {
  try {
    return JSON.parse(body) as unknown
  } catch (error) {
    logger.warn({
      err: error as Error,
      keyId,
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
  const json = parseJsonBody({ body, keyId })
  if (!json) return null

  const actor = Actor.safeParse(json)
  const normalizedKeyId = normalizeActivityPubUri(keyId)
  const normalizedKeyOwner = normalizeActorId(keyId)
  if (!normalizedKeyId || !normalizedKeyOwner) return null

  if (actor.success) {
    const normalizedActorId = normalizeActorId(actor.data.id)
    const normalizedActorPublicKeyId = normalizeActivityPubUri(
      actor.data.publicKey.id
    )
    const normalizedPublicKeyOwner = normalizeActorId(
      actor.data.publicKey.owner
    )
    if (
      !normalizedActorId ||
      !normalizedActorPublicKeyId ||
      normalizedActorId !== normalizedPublicKeyOwner
    ) {
      return null
    }

    if (
      normalizedActorId !== normalizedKeyOwner &&
      normalizedActorPublicKeyId !== normalizedKeyId
    ) {
      return null
    }

    return {
      type: 'actor',
      actorId: actor.data.id,
      keyId: actor.data.publicKey.id,
      requiresOwnerValidation: normalizedActorId !== normalizedKeyOwner,
      details: {
        owner: actor.data.id,
        publicKey: actor.data.publicKey.publicKeyPem
      }
    }
  }

  const publicKeyDocument = PublicKeyDocument.safeParse(json)
  if (!publicKeyDocument.success) return null
  if (normalizeActivityPubUri(publicKeyDocument.data.id) !== normalizedKeyId) {
    return null
  }

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
    headers: ({ url }) =>
      activityPubRequestHeaders({
        url: url.toString(),
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
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>,
  database: Database
) => {
  if (!owner) return null
  const normalizedOwner = normalizeActorId(owner)
  const normalizedKeyId = normalizeActivityPubUri(keyId)
  if (!normalizedOwner || !normalizedKeyId) return null
  if (!(await canFederateWithDomain(database, normalizedOwner))) return null

  const ownerResponse = await fetchSenderPublicKey(
    normalizedOwner,
    signingActor
  )
  if (ownerResponse.statusCode !== 200) return null
  if (ownerResponse.document?.type !== 'actor') return null

  const ownerDocument = ownerResponse.document
  if (normalizeActorId(ownerDocument.actorId) !== normalizedOwner) return null
  if (normalizeActivityPubUri(ownerDocument.keyId) !== normalizedKeyId) {
    return null
  }
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
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>,
  database: Database
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
      signingActor,
      database
    )
  }

  return validateOwnerActorKey(
    {
      keyId: document.keyId,
      owner: document.details.owner,
      publicKey: document.details.publicKey
    },
    signingActor,
    database
  )
}

const fetchSenderPublicKeyDetails = async (
  actorId: string,
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>,
  database: Database
) => {
  const response = await fetchSenderPublicKey(actorId, signingActor)
  return {
    details: await resolveFetchedPublicKey(
      response.document,
      signingActor,
      database
    ),
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
  const response = await fetchSenderPublicKeyDetails(
    actorId,
    signingActor,
    database
  )
  if (response.details) return response.details

  if (response.statusCode === 410) {
    const url = new URL(actorId)
    const fallbackResponse = await fetchSenderPublicKeyDetails(
      new URL('/actor#main-key', url).toString(),
      signingActor,
      database
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
