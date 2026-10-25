import { getConfig } from '@/lib/config'
import type { ActorHandle } from '@/lib/database/domains/actorHandle/types'
import type { Database } from '@/lib/database/types'
import { MOVE_COOLDOWN_MS } from '@/lib/services/accounts/migration/outgoingMove'
import {
  getActorDomainChoices,
  getActorDomainRules,
  getAddableActorDomains,
  resolveActorDomain
} from '@/lib/services/domains/actorDomains'
import { filterActorDomainsForAccount } from '@/lib/services/domains/signUpDomain'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import type { Actor } from '@/lib/types/domain/actor'

// The state behind GET /api/v1/accounts/handle and the 200 body of its POST:
// the current handle, the ledger history, the rename cooldown and the domains
// the account may still rename onto.
export type HandleState = {
  actorId: string
  username: string
  domain: string
  acct: string
  history: ActorHandle[]
  cooldownUntil: string | null
  domains: string[]
}

// The actor-domain pipeline POST /api/v1/actors uses: the rules resolve the
// requested (or defaulted) domain, and the account's sign-up filter narrows
// it. Returns null when the domain is not one the account may use.
//
// A target that IS the current domain (case-insensitively), whether it was
// sent explicitly or defaulted, skips the pipeline entirely: the handle
// already lives there, so a later-narrowed `allowActorDomains` or sign-up
// filter must not strand a plain username change (GET always offers the
// current domain for the same reason). Only a domain CHANGE goes through
// resolveActorDomain + filterActorDomainsForAccount.
export const resolveAllowedDomain = async (
  database: Database,
  actor: Actor,
  requestedDomain: string | undefined,
  currentHost: string
): Promise<string | null> => {
  const currentDomain = actor.domain ?? ''
  if (
    currentDomain &&
    (requestedDomain === undefined ||
      requestedDomain.toLowerCase() === currentDomain.toLowerCase())
  ) {
    return currentDomain
  }
  const config = getConfig()
  const [{ federation }, addableDomains] = await Promise.all([
    getResolvedServerSettings(database),
    getAddableActorDomains(database)
  ])
  const domain = resolveActorDomain(
    requestedDomain ?? actor.domain ?? currentHost,
    getActorDomainRules(config, federation.allowActorDomains, addableDomains)
  )
  if (!domain || !actor.account) return null
  if (
    !(await filterActorDomainsForAccount(database, actor.account.id, [domain]))
      .length
  ) {
    return null
  }
  return domain
}

export const getHandleState = async ({
  database,
  actor,
  currentHost
}: {
  database: Database
  actor: Actor
  currentHost: string
}): Promise<HandleState> => {
  const [history, latestReplacedAt] = await Promise.all([
    database.getActorHandles({ actorId: actor.id }),
    database.getLatestActorHandleReplacedAt({ actorId: actor.id })
  ])
  const cooldownEnd =
    latestReplacedAt !== null ? latestReplacedAt + MOVE_COOLDOWN_MS : null

  const config = getConfig()
  const [{ federation }, addableDomains] = await Promise.all([
    getResolvedServerSettings(database),
    getAddableActorDomains(database)
  ])
  const choices = getActorDomainChoices(
    getActorDomainRules(config, federation.allowActorDomains, addableDomains),
    currentHost
  )
  const filtered = actor.account
    ? await filterActorDomainsForAccount(database, actor.account.id, choices)
    : []
  // The current domain is always offered, whatever the account filter says:
  // it is where the handle already lives.
  const domains = [...new Set([...filtered, actor.domain.toLowerCase()])]

  return {
    actorId: actor.id,
    username: actor.username,
    domain: actor.domain,
    acct: `${actor.username}@${actor.domain}`,
    history,
    // Null when the actor never replaced a handle, or the cooldown elapsed.
    cooldownUntil:
      cooldownEnd !== null && cooldownEnd > Date.now()
        ? new Date(cooldownEnd).toISOString()
        : null,
    domains
  }
}
