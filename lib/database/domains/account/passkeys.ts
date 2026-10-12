import type {
  AccountPasskey,
  GetAccountPasskeysParams
} from '@/lib/database/domains/account/types'
import type { Db } from '@/lib/database/kysely'

export const getAccountPasskeys = async (
  db: Db,
  { accountId }: GetAccountPasskeysParams
): Promise<AccountPasskey[]> => {
  // Never selects `publicKey`, `credentialID`, `counter` or `transports`:
  // the list only describes each passkey. better-auth's own list endpoint
  // does not expose `rpID`, which is why this reads the table directly.
  const rows = await db
    .selectFrom('passkey')
    .select([
      'id',
      'name',
      'rpID',
      'deviceType',
      'backedUp',
      'createdAt',
      'aaguid'
    ])
    .where('userId', '=', accountId)
    .orderBy('createdAt', 'asc')
    .execute()
  return rows
}
