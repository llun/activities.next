// The headless instance actor that signs outgoing federation requests.
import { type SqlBool, sql } from 'kysely'

import { getConfig } from '@/lib/config'
import {
  asSQLActor,
  getActor,
  getConfiguredActorDomain,
  isValidFederationSigningSQLActor
} from '@/lib/database/domains/actor/rows'
import type { Db } from '@/lib/database/kysely'
import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import {
  FEDERATION_SIGNING_ACTOR_TYPE,
  FEDERATION_SIGNING_ACTOR_USERNAME,
  getFederationSigningActorId,
  getFederationSigningActorUsername
} from '@/lib/services/federation/instanceActor'
import type { Actor } from '@/lib/types/domain/actor'
import { generatePublicId } from '@/lib/utils/publicId'
import { generateKeyPair } from '@/lib/utils/signature'

const FEDERATION_SIGNING_ACTOR_USERNAME_LIKE_PATTERN = `${FEDERATION_SIGNING_ACTOR_USERNAME.replace(/[\\%_]/g, '\\$&')}%`

const isSigningActorUsername = sql<SqlBool>`${sql.ref('username')} like ${FEDERATION_SIGNING_ACTOR_USERNAME_LIKE_PATTERN} escape '\\'`

// Process-local only; cross-process races still rely on the actor id unique
// constraint plus insert recovery below.
const federationSigningActorCreationLocks = new Map<
  string,
  Promise<Actor | null>
>()

const getFederationSigningActorSettings = (
  actorId: string,
  domain: string
) => ({
  followersUrl: `${actorId}/followers`,
  inboxUrl: `${actorId}/inbox`,
  sharedInboxUrl: `https://${domain}/inbox`
})

const getActorFromRow = (row: object | undefined, domain: string) => {
  const sqlActor = row ? asSQLActor(row) : undefined
  if (!isValidFederationSigningSQLActor(sqlActor, domain)) return null
  return getActor(sqlActor, 0, 0, 0, 0)
}

const selectActorById = (db: Db, id: string) =>
  db
    .selectFrom('actors')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()

// The oldest valid signer among the local service actors on `domain`.
const getExistingHeadlessActor = async (db: Db, domain: string) => {
  const rows = await db
    .selectFrom('actors')
    .selectAll()
    .where('domain', '=', domain)
    .where('type', '=', FEDERATION_SIGNING_ACTOR_TYPE)
    .where(isSigningActorUsername)
    .where('accountId', 'is', null)
    .where(isLocalActor)
    .where('deletionStatus', 'is', null)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute()

  for (const row of rows) {
    const actor = getActorFromRow(row, domain)
    if (actor) return actor
  }
  return null
}

const createSigningActor = async (db: Db, domain: string) => {
  const reservedActor = getActorFromRow(
    await selectActorById(db, getFederationSigningActorId(domain)),
    domain
  )
  if (reservedActor) return reservedActor

  const existingHeadlessActor = await getExistingHeadlessActor(db, domain)
  if (existingHeadlessActor) return existingHeadlessActor

  const usedUsernames = new Set(
    (
      await db
        .selectFrom('actors')
        .select('username')
        .where('domain', '=', domain)
        .where(isSigningActorUsername)
        .execute()
    ).map((actor) => actor.username)
  )
  let username = FEDERATION_SIGNING_ACTOR_USERNAME
  for (let index = 0; usedUsernames.has(username); index += 1) {
    username = getFederationSigningActorUsername(index + 1)
  }
  const signingActorId = getFederationSigningActorId(domain, username)

  const currentTime = new Date()
  const keyPair = await generateKeyPair(getConfig().secretPhase)
  try {
    await db
      .insertInto('actors')
      .values({
        id: signingActorId,
        publicId: generatePublicId(),
        type: FEDERATION_SIGNING_ACTOR_TYPE,
        username,
        domain,
        name: 'Instance actor',
        summary: 'Service actor used for ActivityPub federation signing.',
        accountId: null,
        settings: JSON.stringify(
          getFederationSigningActorSettings(signingActorId, domain)
        ),
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .execute()
  } catch (error) {
    const actor = await getExistingHeadlessActor(db, domain)
    if (actor) return actor
    throw error
  }

  return getActorFromRow(await selectActorById(db, signingActorId), domain)
}

export const getFederationSigningActor = async (
  db: Db
): Promise<Actor | null> => {
  const domain = getConfiguredActorDomain()
  const pendingActor = federationSigningActorCreationLocks.get(domain)
  if (pendingActor) return pendingActor

  const creatingActor = createSigningActor(db, domain)
  federationSigningActorCreationLocks.set(domain, creatingActor)
  try {
    return await creatingActor
  } finally {
    if (federationSigningActorCreationLocks.get(domain) === creatingActor) {
      federationSigningActorCreationLocks.delete(domain)
    }
  }
}
