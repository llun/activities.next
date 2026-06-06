// This schema is based on
// https://docs.joinmastodon.org/entities/Account/#CredentialAccount
// The CredentialAccount is the extended Account shape returned by the
// verify_credentials and update_credentials endpoints. On top of the public
// Account it carries a populated `source` (with the real follow_requests_count)
// and the account's `role`.
import { z } from 'zod'

import { Account } from '../account'
import { Role } from './role'

export const CredentialAccount = Account.extend({
  role: Role.describe('The role assigned to the currently authorized user')
})
export type CredentialAccount = z.infer<typeof CredentialAccount>
