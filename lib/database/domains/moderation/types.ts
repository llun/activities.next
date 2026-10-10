// Parameter and result types of the moderation domain (actor and account
// moderation state, the moderation audit log, report resolution) and of the
// Admin::Account listing and lookup it serves.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import { z } from 'zod'

import type { SQLAccount, SQLActor } from '@/lib/types/database/rows'

// The moderator actions recorded in the append-only `moderation_actions` audit
// log. `none` is an audit-only action (e.g. resolving a report with no state
// change). The rest mirror the admin account action matrix.
export const ModerationActionType = z.enum([
  'none',
  'disable',
  'enable',
  'sensitive',
  'unsensitive',
  'silence',
  'unsilence',
  'suspend',
  'unsuspend',
  'approve',
  'reject',
  'destroy'
])
export type ModerationActionType = z.infer<typeof ModerationActionType>

// Per-actor moderation state, read as epoch-millisecond timestamps (null when
// the state is not set). Only actors carrying at least one non-null state are
// returned by getModerationStatesForActors, so an absent map entry means the
// actor is not moderated.
export type ModerationStates = {
  suspendedAt: number | null
  silencedAt: number | null
  sensitizedAt: number | null
}

export type ModerationAction = {
  id: string
  targetActorId: string
  moderatorAccountId: string
  moderatorActorId: string | null
  action: ModerationActionType
  reportId: string | null
  text: string
  createdAt: number
}

export type SetActorSuspendedParams = { actorId: string; suspended: boolean }
export type SetActorSilencedParams = { actorId: string; silenced: boolean }
export type SetActorSensitizedParams = { actorId: string; sensitized: boolean }
export type SetAccountDisabledParams = { accountId: string; disabled: boolean }
export type ApproveAccountParams = { accountId: string }
export type RejectPendingAccountParams = { accountId: string }
export type GetModerationStatesForActorsParams = { actorIds: string[] }
export type CreateModerationActionParams = {
  targetActorId: string
  moderatorAccountId: string
  moderatorActorId?: string | null
  action: ModerationActionType
  reportId?: string | null
  text?: string
}
export type DeleteAllAccountSessionsParams = { accountId: string }
export type SetReportResolutionParams = {
  reportId: string
  // true → mark action_taken with the timestamp and moderator; false → reopen
  // (clear all three).
  resolved: boolean
  actionTakenByActorId?: string | null
}

export interface ModerationDatabase {
  // Stamp/clear the actor state columns. Idempotent: setting a state that is
  // already set refreshes the timestamp; clearing an unset state is a no-op.
  setActorSuspended(params: SetActorSuspendedParams): Promise<void>
  setActorSilenced(params: SetActorSilencedParams): Promise<void>
  setActorSensitized(params: SetActorSensitizedParams): Promise<void>
  // Login-level state, on the account row (no remote analogue).
  setAccountDisabled(params: SetAccountDisabledParams): Promise<void>
  // Idempotently mark an account approved (sets approvedAt only when null).
  approveAccount(params: ApproveAccountParams): Promise<void>
  // Delete a registration-pending account (approvedAt null) and all its actors
  // in one transaction. Returns false (and changes nothing) for an already
  // approved account.
  rejectPendingAccount(params: RejectPendingAccountParams): Promise<boolean>
  // Batch-load the moderation state for a set of actor ids in one query. Only
  // moderated actors (≥1 non-null state) appear in the returned map.
  getModerationStatesForActors(
    params: GetModerationStatesForActorsParams
  ): Promise<Map<string, ModerationStates>>
  // Append an immutable audit-log row and return it.
  createModerationAction(
    params: CreateModerationActionParams
  ): Promise<ModerationAction>
  // Revoke every better-auth session for the account (used by disable/suspend).
  deleteAllAccountSessions(
    params: DeleteAllAccountSessionsParams
  ): Promise<void>
  // Resolve/reopen a report's action-taken workflow columns. Returns true when
  // a matching report row was updated. Shared by the account action endpoint
  // (resolve on moderation) and the admin reports API.
  setReportResolution(params: SetReportResolutionParams): Promise<boolean>
}

// Admin Accounts (Admin::Account listing/lookup)

// One actor row plus its owning account row (null for remote actors). The
// Admin::Account serializer hydrates both plus session IPs and the public
// Account entity.
export type AdminAccountRecord = {
  actor: SQLActor
  account: SQLAccount | null
}

export type AdminAccountIp = { ip: string; usedAt: number }

export type GetAdminAccountsParams = {
  limit?: number
  // Locality: local = account-backed on this instance; remote = foreign actor.
  local?: boolean
  remote?: boolean
  // Status filters (v1 booleans; v2 `status`/`origin` map onto these).
  active?: boolean
  pending?: boolean
  disabled?: boolean
  silenced?: boolean
  suspended?: boolean
  sensitized?: boolean
  // Text filters.
  username?: string
  displayName?: string
  byDomain?: string
  email?: string
  ip?: string
  staff?: boolean
  // Keyset cursors on (createdAt desc, id) — actor-URL ids.
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export type GetAdminAccountParams = { actorId: string }
export type GetAdminAccountRecordsParams = { actorIds: string[] }
export type GetSessionIpsForAccountsParams = { accountIds: string[] }

export interface AdminAccountDatabase {
  // Actor-driven, filter/keyset-paginated listing for the admin accounts API.
  getAdminAccounts(
    params: GetAdminAccountsParams
  ): Promise<AdminAccountRecord[]>
  // Single Admin::Account record by actor id (URL form), or null.
  getAdminAccount(
    params: GetAdminAccountParams
  ): Promise<AdminAccountRecord | null>
  // Batch Admin::Account records by actor ids (URL form); order not guaranteed.
  // Used to hydrate the four embedded accounts on Admin::Report.
  getAdminAccountRecords(
    params: GetAdminAccountRecordsParams
  ): Promise<AdminAccountRecord[]>
  // Latest-first session IPs per account (local accounts only carry sessions).
  getSessionIpsForAccounts(
    params: GetSessionIpsForAccountsParams
  ): Promise<Map<string, AdminAccountIp[]>>
}
