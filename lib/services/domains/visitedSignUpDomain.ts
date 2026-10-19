import { headers } from 'next/headers'

import { Database } from '@/lib/database/types'
import { headerHost } from '@/lib/services/guards/headerHost'

import { ensureServedDomainsFresh } from './servedDomainSnapshot'
import { type SignUpDomain, resolveSignUpDomain } from './signUpDomain'

/**
 * The sign-up settings of the domain the current page request arrived on, for
 * server components (the sign-up page, the landing card, the sign-in line and
 * the public "Create account" links). Route handlers pass their own request's
 * `headerHost` to `resolveSignUpDomain` instead.
 */
export const getVisitedSignUpDomain = async (
  database: Database
): Promise<SignUpDomain> => {
  // Refresh first: `headerHost` trusts the visited host from the snapshot.
  await ensureServedDomainsFresh()
  return resolveSignUpDomain(database, headerHost(await headers()))
}
