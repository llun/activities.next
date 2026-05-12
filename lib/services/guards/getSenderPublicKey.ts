import { z } from 'zod'

import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/activitypub'
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

const EMPTY_PUBLIC_KEY_DETAILS: SenderPublicKeyDetails = {
  owner: null,
  publicKey: ''
}

const removeFragment = (actorId: string) => actorId.split('#')[0]

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

  const actorIdWithoutFragment = removeFragment(actorId)
  if (actorIdWithoutFragment === actorId) return null

  const fragmentLocalActor = await database.getActorFromId({
    id: actorIdWithoutFragment
  })
  if (!fragmentLocalActor) return null

  return {
    owner: fragmentLocalActor.id,
    publicKey: fragmentLocalActor.publicKey
  }
}

const parseSenderPublicKeyDetails = ({
  body,
  keyId
}: {
  body: string
  keyId: string
}): SenderPublicKeyDetails | null => {
  const json = JSON.parse(body)
  const actor = Actor.safeParse(json)
  if (actor.success) {
    if (actor.data.id !== keyId && actor.data.publicKey.id !== keyId) {
      return null
    }

    return {
      owner: actor.data.publicKey.owner,
      publicKey: actor.data.publicKey.publicKeyPem
    }
  }

  const publicKeyDocument = PublicKeyDocument.safeParse(json)
  if (!publicKeyDocument.success) return null
  if (publicKeyDocument.data.id !== keyId) return null

  return {
    owner: publicKeyDocument.data.owner,
    publicKey: publicKeyDocument.data.publicKeyPem
  }
}

const fetchSenderPublicKeyDetails = async (
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
      details: null,
      statusCode: response.statusCode
    }
  }

  return {
    details: parseSenderPublicKeyDetails({
      body: response.body,
      keyId: actorId
    }),
    statusCode: response.statusCode
  }
}

export async function getSenderPublicKeyDetails(
  database: Database,
  actorId: string
): Promise<SenderPublicKeyDetails> {
  try {
    const localPublicKey = await getLocalSenderPublicKeyDetails(
      database,
      actorId
    )
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
  } catch {
    return EMPTY_PUBLIC_KEY_DETAILS
  }

  return EMPTY_PUBLIC_KEY_DETAILS
}

export async function getSenderPublicKey(database: Database, actorId: string) {
  const tracer = getTracer()
  return tracer.startActiveSpan(
    'guard.getSenderPublicKey',
    { attributes: { actorId } },
    async (span) => {
      try {
        const sender = await getSenderPublicKeyDetails(database, actorId)
        return sender.publicKey
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        return ''
      } finally {
        span.end()
      }
    }
  )
}
