import { Account } from '@/lib/models/account'
import { Actor } from '@/lib/models/actor'
import { Session } from '@/lib/models/session'

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
export type GetAccountFromEmailParams = { email: string }
export type GetAccountFromProviderIdParams = {
  provider: string
  accountId: string
}
export type LinkAccountWithProviderParams = {
  accountId: string
  provider: string
  providerAccountId: string
}
export type VerifyAccountParams = {
  verificationCode: string
}
export type CreateAccountSessionParams = {
  accountId: string
  token: string
  expireAt: number
  actorId?: string | null
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

export type GetAccountProvidersParams = {
  accountId: string
}

export type UnlinkAccountFromProviderParams = {
  accountId: string
  provider: string
}

export type CreateActorForAccountParams = {
  accountId: string
  username: string
  domain: string
  privateKey: string
  publicKey: string
}
export type GetActorsForAccountParams = { accountId: string }
export type SetDefaultActorParams = { accountId: string; actorId: string }
export type SetSessionActorParams = { token: string; actorId: string }

export type RequestEmailChangeParams = {
  accountId: string
  newEmail: string
  emailChangeCode: string
}
export type VerifyEmailChangeParams = {
  accountId?: string
  emailChangeCode: string
}
export type ChangePasswordParams = {
  accountId: string
  newPasswordHash: string
}

export interface AccountDatabase {
  isAccountExists(params: IsAccountExistsParams): Promise<boolean>
  isUsernameExists(params: IsUsernameExistsParams): Promise<boolean>

  createAccount(params: CreateAccountParams): Promise<string>
  getAccountFromId(params: GetAccountFromIdParams): Promise<Account | null>
  getAccountFromEmail(
    params: GetAccountFromEmailParams
  ): Promise<Account | null>
  getAccountFromProviderId(
    params: GetAccountFromProviderIdParams
  ): Promise<Account | null>
  linkAccountWithProvider(
    params: LinkAccountWithProviderParams
  ): Promise<Account | null>
  verifyAccount(params: VerifyAccountParams): Promise<Account | null>

  createAccountSession(params: CreateAccountSessionParams): Promise<void>
  getAccountSession(
    params: GetAccountSessionParams
  ): Promise<{ account: Account; session: Session } | null>
  getAccountAllSessions(params: GetAccountAllSessionsParams): Promise<Session[]>
  updateAccountSession(params: UpdateAccountSessionParams): Promise<void>
  deleteAccountSession(params: DeleteAccountSessionParams): Promise<void>

  getAccountProviders(params: GetAccountProvidersParams): Promise<
    {
      provider: string
      providerId: string
      createdAt: number
      updatedAt: number
    }[]
  >
  unlinkAccountFromProvider(
    params: UnlinkAccountFromProviderParams
  ): Promise<void>

  createActorForAccount(params: CreateActorForAccountParams): Promise<string>
  getActorsForAccount(params: GetActorsForAccountParams): Promise<Actor[]>
  setDefaultActor(params: SetDefaultActorParams): Promise<void>
  setSessionActor(params: SetSessionActorParams): Promise<void>

  requestEmailChange(params: RequestEmailChangeParams): Promise<void>
  verifyEmailChange(params: VerifyEmailChangeParams): Promise<Account | null>
  changePassword(params: ChangePasswordParams): Promise<void>
}
