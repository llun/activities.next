import { getConfig } from '@/lib/config'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { Database } from '@/lib/database/types'
import { DEFAULT_ROLE } from '@/lib/services/accounts/credentialAccount'
import { isAccountConfirmationPending } from '@/lib/services/auth/canCreateSessionForAccount'
import { Mastodon } from '@/lib/types/activitypub'
import {
  AdminAccountIp,
  AdminAccountRecord
} from '@/lib/types/database/operations'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getClientActorId, isPublicId } from '@/lib/utils/publicId'
import { safeIdToUrl } from '@/lib/utils/urlToId'

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
  // The public Account entity keyed by its emitted Mastodon id
  // (getClientActorId(actor)).
  publicAccountById: Map<string, Mastodon.Account>
}

export const serializeAdminAccounts = ({
  records,
  sessionIps,
  publicAccountById
}: SerializeAdminAccountsParams): Mastodon.AdminAccount[] => {
  const host = configuredHost()

  return records.flatMap(({ actor, account }) => {
    // Doubles as the join key into publicAccountById, which is keyed by the
    // public Account entity's emitted id — both sides flip together.
    const id = getClientActorId(actor)
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
        // Read the same signal the auth guards do, not `verifiedAt`:
        // `accounts.verifiedAt` carries DEFAULT CURRENT_TIMESTAMP, so it is
        // non-null for every account written before that was worked around and
        // reported `confirmed: true` for exactly the accounts a moderator would
        // be looking at BECAUSE they cannot sign in. A pending
        // `verificationCode` is what the guards refuse on.
        // Remote actors have no registration state, so they are reported
        // confirmed for the same reason the line below reports them approved —
        // stated explicitly rather than falling out of an empty object.
        confirmed: account ? !isAccountConfirmationPending(account) : true,
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

// Resolve the `[id]` path param — a UUIDv7 publicId, or the legacy
// `urlToId(actor.id)` form for a publicId-less row — to its AdminAccountRecord,
// or null when the id is undecodable or unknown (an unresolvable publicId keeps
// the same null contract as an undecodable legacy id).
export const resolveAdminAccountRecord = async (
  database: Database,
  id: string
): Promise<AdminAccountRecord | null> => {
  const actorId = isPublicId(id)
    ? await database.getActorIdByPublicId({ publicId: id })
    : safeIdToUrl(id)
  if (!actorId) return null
  return database.getAdminAccount({ actorId })
}
