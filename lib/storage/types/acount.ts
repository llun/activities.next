import { Account } from '../../models/account'
import { Session } from '../../models/session'

export type IsAccountExistsParams = { email: string }
export type IsUsernameExistsParams = { username: string; domain: string }
export type CreateAccountParams = {
  email: string
  username: string
  passwordHash: string
  verificationCode?: string | null
  domain: string
  privateKey: string
  publicKey: string
}
export type GetAccountFromIdParams = { id: string }
export type GetAccountFromProviderIdParams = {
  provider: string
  accountId: string
}
export type LinkAccountWithProviderParams = {
  accountId: string
  provider: string
  providerAccountId: string
}
export type CreateAccountSessionParams = {
  accountId: string
  token: string
  expireAt: number
}
export type GetAccountSessionParams = {
  token: string
}
export type GetAccountAllSessionsParams = {
  accountId: string
}
export type DeleteAccountSessionParams = {
  token: string
}
export type UpdateAccountSessionParams = {
  token: string
  expireAt?: number
}

export interface AccountStorage {
  isAccountExists(params: IsAccountExistsParams): Promise<boolean>
  isUsernameExists(params: IsUsernameExistsParams): Promise<boolean>

  createAccount(params: CreateAccountParams): Promise<string>
  getAccountFromId(params: GetAccountFromIdParams): Promise<Account | undefined>
  getAccountFromProviderId(
    params: GetAccountFromProviderIdParams
  ): Promise<Account | undefined>
  linkAccountWithProvider(
    params: LinkAccountWithProviderParams
  ): Promise<Account | undefined>

  createAccountSession(params: CreateAccountSessionParams): Promise<void>
  getAccountSession(
    params: GetAccountSessionParams
  ): Promise<{ account: Account; session: Session } | undefined>
  getAccountAllSessions(params: GetAccountAllSessionsParams): Promise<Session[]>
  updateAccountSession(params: UpdateAccountSessionParams): Promise<void>
  deleteAccountSession(params: DeleteAccountSessionParams): Promise<void>
}
