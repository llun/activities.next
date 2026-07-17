import { getConfig } from '@/lib/config'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { Database } from '@/lib/database/types'
import { DEFAULT_ROLE } from '@/lib/services/accounts/credentialAccount'
import { Mastodon } from '@/lib/types/activitypub'
import {
  AdminAccountIp,
  AdminAccountRecord
} from '@/lib/types/database/operations'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { safeIdToUrl, urlToId } from '@/lib/utils/urlToId'

// This server has no roles system, so an account marked `role = 'admin'` is
// reported with a minimal admin Role object; everyone else gets the default
// "everyone" role (DEFAULT_ROLE), and remote actors get null (no login/role).
const ADMIN_ROLE: Mastodon.Role = {
  id: '3',
  name: 'Admin',
  color: '',
  permissions: '1',
  highlighted: true
}

const configuredHost = (): string => {
  const host = getConfig().host
  return (host.includes('://') ? new URL(host).host : host).toLowerCase()
}

export type SerializeAdminAccountsParams = {
  records: AdminAccountRecord[]
  // Latest-first session IPs keyed by account id (local accounts only).
  sessionIps: Map<string, AdminAccountIp[]>
  // The public Account entity keyed by its Mastodon id (urlToId(actor.id)).
  publicAccountById: Map<string, Mastodon.Account>
}

export const serializeAdminAccounts = ({
  records,
  sessionIps,
  publicAccountById
}: SerializeAdminAccountsParams): Mastodon.AdminAccount[] => {
  const host = configuredHost()

  return records.flatMap(({ actor, account }) => {
    const id = urlToId(actor.id)
    const publicAccount = publicAccountById.get(id)
    // A record with no serializable public account (e.g. a headless actor that
    // slipped through) is dropped rather than emitting a malformed entity.
    if (!publicAccount) return []

    const isLocalHost = actor.domain.toLowerCase() === host
    const ips = (account ? (sessionIps.get(account.id) ?? []) : []).map(
      (entry): Mastodon.AdminIp => ({
        ip: entry.ip,
        used_at: getISOTimeUTC(entry.usedAt)
      })
    )

    const role: Mastodon.Role | null = !account
      ? null
      : account.role === 'admin'
        ? ADMIN_ROLE
        : DEFAULT_ROLE

    return [
      Mastodon.AdminAccount.parse({
        id,
        username: actor.username,
        domain: isLocalHost ? null : actor.domain.toLowerCase(),
        created_at: getISOTimeUTC(getCompatibleTime(actor.createdAt)),
        email: account?.email ?? '',
        ip: ips[0]?.ip ?? null,
        ips,
        locale: null,
        invite_request: null,
        role,
        confirmed: Boolean(account?.verifiedAt || account?.emailVerifiedAt),
        // Remote actors have no registration state; treat them as approved.
        approved: account ? Boolean(account.approvedAt) : true,
        disabled: Boolean(account?.disabledAt),
        silenced: Boolean(actor.silencedAt),
        suspended: Boolean(actor.suspendedAt),
        sensitized: Boolean(actor.sensitizedAt),
        account: publicAccount
      })
    ]
  })
}

// Hydrate a batch of AdminAccountRecords into serialized Admin::Account
// entities: batch-load session IPs and the public Account entities, then
// serialize. Shared by the list, lookup, and state-change routes.
export const hydrateAdminAccounts = async (
  database: Database,
  records: AdminAccountRecord[]
): Promise<Mastodon.AdminAccount[]> => {
  if (records.length === 0) return []

  const accountIds = records
    .map((record) => record.account?.id)
    .filter((id): id is string => Boolean(id))
  const actorIds = records.map((record) => record.actor.id)

  const [sessionIps, publicAccounts] = await Promise.all([
    database.getSessionIpsForAccounts({ accountIds }),
    database.getMastodonActorsFromIds({ ids: actorIds })
  ])
  const publicAccountById = new Map(
    publicAccounts.map((account) => [account.id, account])
  )
  return serializeAdminAccounts({ records, sessionIps, publicAccountById })
}

// Resolve the `[id]` path param (a Mastodon id, i.e. urlToId(actor.id)) to its
// AdminAccountRecord, or null when the id is undecodable or unknown.
export const resolveAdminAccountRecord = async (
  database: Database,
  id: string
): Promise<AdminAccountRecord | null> => {
  const actorId = safeIdToUrl(id)
  if (!actorId) return null
  return database.getAdminAccount({ actorId })
}
