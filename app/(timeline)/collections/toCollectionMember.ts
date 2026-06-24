import { CollectionMember } from '@/app/(timeline)/collections/CollectionEditor'
import { Mastodon } from '@/lib/types/activitypub'

// Map a Mastodon Account into the CollectionMember shape used by the editor and
// the detail roster. `acct` is a bare username for local accounts, so qualify it
// with the instance host to always render a full @user@domain handle.
export const toCollectionMember = (
  account: Mastodon.Account,
  host: string
): CollectionMember => ({
  id: account.id,
  name: account.display_name || account.username,
  handle: account.acct.includes('@') ? account.acct : `${account.acct}@${host}`,
  avatar: account.avatar
})
