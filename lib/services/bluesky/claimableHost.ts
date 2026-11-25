import type { Actor } from '@/lib/types/domain/actor'
import { getServedAuthority } from '@/lib/utils/host'

/**
 * The served domain the actor lives on: the host it may answer
 * /.well-known/atproto-did for, as a linked account's claim (Settings › Other
 * networks) or as a hosted account's handle. A handle carries no port, so a
 * host with one cannot be claimed.
 */
export const getClaimableHost = (actor: Pick<Actor, 'domain'>) => {
  const host = getServedAuthority(actor.domain)
  // The holder check matches lower(actors.domain); a row spelled any other
  // way (a default port, a trailing dot) could claim but never be served.
  return !host || host.includes(':') || host !== actor.domain.toLowerCase()
    ? null
    : host
}
