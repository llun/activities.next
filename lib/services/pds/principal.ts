import { getPdsConfig } from '@/lib/config/blueskyPds'
import type { PdsRepo } from '@/lib/database/domains/pds/types'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import { normalizeServedDomainChoice } from '@/lib/utils/host'

import { resolveEffectivePdsRepoStatus } from './effectiveStatus'
import {
  PdsAccountDeactivatedError,
  PdsAccountNotFoundError,
  PdsAccountTakedownError
} from './errors'
import { getMovedToHost } from './moved'

export type PdsPrincipal = { repo: PdsRepo; actor: Actor }

/**
 * The hosted repo and actor behind `did`, but only when the account may act on
 * this PDS: the repo belongs to `domain`, that domain's PDS is enabled, the
 * repo's effective status is active (not suspended, disabled, unconfirmed,
 * unapproved or deleting), and the account has not moved out.
 *
 * Throws the atproto account errors later endpoints answer with:
 * `AccountNotFound`, `AccountTakedown` or `AccountDeactivated`.
 */
export const requireActiveHostedPrincipal = async (
  database: Database,
  { did, domain }: { did: string; domain: string }
): Promise<PdsPrincipal> => {
  const normalizedDomain = normalizeServedDomainChoice(domain)
  const domainConfig = normalizedDomain
    ? getPdsConfig()?.[normalizedDomain]
    : undefined
  if (!normalizedDomain || !domainConfig?.enabled) {
    throw new PdsAccountNotFoundError(did)
  }

  const repo = await database.getPdsRepo({ did })
  if (!repo || repo.domain !== normalizedDomain) {
    throw new PdsAccountNotFoundError(did)
  }

  const actor = await database.getActorFromId({ id: repo.actorId })
  if (!actor) {
    throw new PdsAccountNotFoundError(did)
  }

  if (getMovedToHost(repo)) {
    throw new PdsAccountDeactivatedError(did)
  }

  const status = resolveEffectivePdsRepoStatus(repo, actor)
  if (status === 'takendown') {
    throw new PdsAccountTakedownError(did)
  }
  if (status === 'deactivated') {
    throw new PdsAccountDeactivatedError(did)
  }
  if (status === 'deleted') {
    throw new PdsAccountNotFoundError(did)
  }
  // Fail closed on any status the code does not know, not only the named ones.
  if (status !== 'active' || repo.status !== 'active') {
    throw new PdsAccountDeactivatedError(did)
  }

  return { repo, actor }
}
