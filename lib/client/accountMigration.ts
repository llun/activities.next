import { throwApiError } from './http'

// The shapes of this server's own account portability API:
// /api/v1/accounts/handle, /api/v1/accounts/aliases and
// /api/v1/accounts/migration. Every function sends `actorId` (query on
// GET/DELETE, body on POST) so the server can answer 409 'Actor changed'.

export interface AccountAliasItem {
  id: string
  acct: string | null
}

export interface AccountHandleHistoryItem {
  id: string
  actorId: string
  username: string
  domain: string
  createdAt: number
  replacedAt: number | null
}

export interface AccountHandleState {
  actorId: string
  username: string
  domain: string
  acct: string
  history: AccountHandleHistoryItem[]
  cooldownUntil: string | null
  domains: string[]
}

export type AccountMigrationKind = 'move' | 'redirect'

export interface AccountMigrationState {
  movedTo: { id: string; acct: string | null } | null
  migrations: {
    targetActorId: string
    acct: string
    kind: AccountMigrationKind
    createdAt: string
  }[]
  cooldownUntil: string | null
  followersCount: number
}

const getAccountHandleState = async (
  response: Response
): Promise<AccountHandleState> => {
  const data = await response.json()
  if (typeof data?.acct !== 'string') {
    throw new Error('Could not load your handle')
  }
  return data as AccountHandleState
}

const getAccountMigrationState = async (
  response: Response
): Promise<AccountMigrationState> => {
  const data = await response.json()
  if (data && typeof data === 'object' && 'cooldownUntil' in data) {
    return data as AccountMigrationState
  }
  throw new Error('Could not load your move')
}

const getAccountAliasItems = async (
  response: Response
): Promise<AccountAliasItem[]> => {
  const data = await response.json()
  if (!Array.isArray(data)) {
    throw new Error('Could not load your old accounts')
  }
  return data as AccountAliasItem[]
}

export interface GetAccountHandleParams {
  actorId: string
}

export const getAccountHandle = async ({
  actorId
}: GetAccountHandleParams): Promise<AccountHandleState> => {
  const params = new URLSearchParams({ actorId })
  const response = await fetch(`/api/v1/accounts/handle?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    await throwApiError(response, 'Could not load your handle')
  }
  return getAccountHandleState(response)
}

export interface RenameAccountHandleParams {
  actorId: string
  username: string
  domain?: string
  password?: string
  currentUsername?: string
}

export const renameAccountHandle = async ({
  actorId,
  username,
  domain,
  password,
  currentUsername
}: RenameAccountHandleParams): Promise<AccountHandleState> => {
  const response = await fetch('/api/v1/accounts/handle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actorId,
      username,
      ...(domain !== undefined ? { domain } : null),
      ...(password !== undefined ? { password } : null),
      ...(currentUsername !== undefined ? { currentUsername } : null)
    })
  })
  if (!response.ok) {
    await throwApiError(response, 'Could not change your handle')
  }
  return getAccountHandleState(response)
}

export interface GetAccountAliasesParams {
  actorId: string
}

export const getAccountAliases = async ({
  actorId
}: GetAccountAliasesParams): Promise<AccountAliasItem[]> => {
  const params = new URLSearchParams({ actorId })
  const response = await fetch(
    `/api/v1/accounts/aliases?${params.toString()}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) {
    await throwApiError(response, 'Could not load your old accounts')
  }
  return getAccountAliasItems(response)
}

export interface AddAccountAliasParams {
  actorId: string
  acct: string
}

export const addAccountAlias = async ({
  actorId,
  acct
}: AddAccountAliasParams): Promise<AccountAliasItem[]> => {
  const response = await fetch('/api/v1/accounts/aliases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, acct })
  })
  if (!response.ok) {
    await throwApiError(response, 'Could not add that account')
  }
  return getAccountAliasItems(response)
}

export interface RemoveAccountAliasParams {
  actorId: string
  id: string
}

export const removeAccountAlias = async ({
  actorId,
  id
}: RemoveAccountAliasParams): Promise<AccountAliasItem[]> => {
  const params = new URLSearchParams({ actorId, id })
  const response = await fetch(
    `/api/v1/accounts/aliases?${params.toString()}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) {
    await throwApiError(response, 'Could not remove that account')
  }
  return getAccountAliasItems(response)
}

export interface GetAccountMigrationParams {
  actorId: string
}

export const getAccountMigration = async ({
  actorId
}: GetAccountMigrationParams): Promise<AccountMigrationState> => {
  const params = new URLSearchParams({ actorId })
  const response = await fetch(
    `/api/v1/accounts/migration?${params.toString()}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) {
    await throwApiError(response, 'Could not load your move')
  }
  return getAccountMigrationState(response)
}

export interface MoveAccountParams {
  actorId: string
  acct: string
  kind: AccountMigrationKind
  password?: string
  username?: string
}

export const moveAccount = async ({
  actorId,
  acct,
  kind,
  password,
  username
}: MoveAccountParams): Promise<AccountMigrationState> => {
  const response = await fetch('/api/v1/accounts/migration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actorId,
      acct,
      kind,
      ...(password !== undefined ? { password } : null),
      ...(username !== undefined ? { username } : null)
    })
  })
  if (!response.ok) {
    await throwApiError(response, 'Could not start the move')
  }
  return getAccountMigrationState(response)
}

export interface CancelAccountRedirectParams {
  actorId: string
}

export const cancelAccountRedirect = async ({
  actorId
}: CancelAccountRedirectParams): Promise<AccountMigrationState> => {
  const params = new URLSearchParams({ actorId })
  const response = await fetch(
    `/api/v1/accounts/migration?${params.toString()}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) {
    await throwApiError(response, 'Could not cancel the redirect')
  }
  return getAccountMigrationState(response)
}
