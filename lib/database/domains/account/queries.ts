import {
  createAccount,
  createActorForAccount,
  getAccountFromEmail,
  getAccountFromId,
  getActorsForAccount,
  isAccountExists,
  isUsernameExists,
  setDefaultActor,
  unlinkAccountFromProvider,
  updateAccountImage,
  updateAccountName,
  verifyAccount
} from '@/lib/database/domains/account/accounts'
import {
  changePassword,
  repointUnconfirmedAccountEmail,
  requestEmailChange,
  requestPasswordReset,
  resetPasswordWithCode,
  validatePasswordResetCode,
  verifyEmailChange
} from '@/lib/database/domains/account/credentials'
import { getAccountPasskeys } from '@/lib/database/domains/account/passkeys'
import {
  createAccountSession,
  deleteAccountSessionById,
  deleteOtherAccountSessions,
  getAccountAllSessions,
  setSessionActorIdByToken
} from '@/lib/database/domains/account/sessions'

// The facade getSQLDatabase binds with bindDb().
export const accountQueries = {
  isAccountExists,
  isUsernameExists,
  createAccount,
  getAccountFromId,
  getAccountFromEmail,
  verifyAccount,
  createAccountSession,
  getAccountAllSessions,
  deleteAccountSessionById,
  deleteOtherAccountSessions,
  setSessionActorIdByToken,
  getAccountPasskeys,
  unlinkAccountFromProvider,
  createActorForAccount,
  getActorsForAccount,
  setDefaultActor,
  requestEmailChange,
  verifyEmailChange,
  requestPasswordReset,
  validatePasswordResetCode,
  resetPasswordWithCode,
  changePassword,
  repointUnconfirmedAccountEmail,
  updateAccountName,
  updateAccountImage
}
