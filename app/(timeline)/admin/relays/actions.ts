'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { followRelay, unfollowRelay } from '@/lib/activities'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Relay } from '@/lib/types/domain/relay'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { logger } from '@/lib/utils/logger'

const ADMIN_RELAYS_PATH = '/admin/relays'

const getAdminDatabase = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) redirect('/')

  return database
}

const redirectWithStatus = (status: string): never => {
  revalidatePath(ADMIN_RELAYS_PATH)
  redirect(`${ADMIN_RELAYS_PATH}?status=${encodeURIComponent(status)}`)
}

const getText = (formData: FormData, key: string): string =>
  String(formData.get(key) ?? '').trim()

const isValidInboxUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const subscribe = async (database: Database, relay: Relay) => {
  const signingActor = await getFederationSigningActor(database)
  if (!signingActor) throw new Error('Failed to load the federation signer')

  const { followActivityId, ok } = await followRelay(relay, signingActor)
  await database.updateRelay({
    id: relay.id,
    state: ok ? 'pending' : 'idle',
    followActivityId,
    lastError: ok ? null : 'Failed to deliver the Follow to the relay inbox'
  })
}

const createRelayOrRedirect = async (
  database: Database,
  inboxUrl: string
): Promise<Relay> => {
  try {
    return await database.createRelay({ inboxUrl })
  } catch (error) {
    logger.error({ message: 'Failed to create relay', inboxUrl, error })
    return redirectWithStatus('duplicate-inbox-url')
  }
}

export async function addRelayAction(formData: FormData) {
  const database = await getAdminDatabase()
  const inboxUrl = getText(formData, 'inboxUrl')
  if (!isValidInboxUrl(inboxUrl)) redirectWithStatus('invalid-inbox-url')

  const relay = await createRelayOrRedirect(database, inboxUrl)
  await subscribe(database, relay)

  redirectWithStatus('relay-added')
}

export async function subscribeRelayAction(formData: FormData) {
  const database = await getAdminDatabase()
  const id = getText(formData, 'id')
  const relay = await database.getRelayById({ id })
  if (relay) await subscribe(database, relay)

  redirectWithStatus('relay-subscribing')
}

export async function unsubscribeRelayAction(formData: FormData) {
  const database = await getAdminDatabase()
  const id = getText(formData, 'id')
  const relay = await database.getRelayById({ id })
  if (relay) {
    const signingActor = await getFederationSigningActor(database)
    if (signingActor) await unfollowRelay(relay, signingActor)
    // Clear the Follow id so a stale/late Accept cannot re-match and resurrect
    // the subscription (acceptRelayRequest also guards on the pending state).
    await database.updateRelay({ id, state: 'idle', followActivityId: null })
  }

  redirectWithStatus('relay-unsubscribed')
}

export async function removeRelayAction(formData: FormData) {
  const database = await getAdminDatabase()
  const id = getText(formData, 'id')
  const relay = await database.getRelayById({ id })
  if (relay && (relay.state === 'accepted' || relay.state === 'pending')) {
    try {
      const signingActor = await getFederationSigningActor(database)
      if (signingActor) await unfollowRelay(relay, signingActor)
    } catch (error) {
      logger.warn({ message: 'Failed to send relay Undo on removal', error })
    }
  }
  await database.deleteRelay({ id })

  redirectWithStatus('relay-removed')
}
