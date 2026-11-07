import { BLUESKY_BRIDGE_DOMAIN } from '@/lib/utils/accountHandle'

export const BLUESKY_BRIDGE_ACTOR_ID = `https://${BLUESKY_BRIDGE_DOMAIN}/${BLUESKY_BRIDGE_DOMAIN}`

export type BlueskySharingStatus = 'Off' | 'Setting up' | 'On'

export interface BlueskySharingState {
  status: BlueskySharingStatus
  handle: string
  requirements: string[]
  federationAllowed: boolean
}

export const getBlueskyHandle = (actor: {
  username: string
  domain: string
}): string =>
  `${actor.username.replace(/[_~]/g, '-')}.${actor.domain}.ap.brid.gy`.toLowerCase()

export const getBlueskyRequirements = (actor: {
  username: string
  name?: string | null
  iconUrl?: string | null
}): string[] => {
  const reasons: string[] = []
  if (!actor.iconUrl?.trim()) reasons.push('Add a profile picture.')
  const name = actor.name?.trim()
  if (!name || name.toLowerCase() === actor.username.toLowerCase()) {
    reasons.push('Set a display name that differs from your username.')
  }
  if (
    !/^[a-z0-9_~-]+$/i.test(actor.username) ||
    /^[_~-]|[_~-]$/.test(actor.username)
  ) {
    reasons.push(
      'Your username must use letters, numbers, _, - or ~ and start and end with a letter or number.'
    )
  }
  return reasons
}

export const getBlueskySharingStatus = (
  blocked: boolean,
  followStatus?: string | null
): BlueskySharingStatus => {
  if (blocked) return 'Off'
  if (followStatus === 'Accepted') return 'On'
  if (followStatus === 'Requested') return 'Setting up'
  return 'Off'
}
