import { getHashFromString } from '@/lib/utils/getHashFromString'

// Queue job ids dedup GLOBALLY, and every producer derives its id by hashing a
// string. An inbound activity's `id` is chosen by the remote sender, so hashing
// it bare let a sender pick the preimage of an INTERNAL job id — an activity
// with `id: "<statusId>#delete"` reserved the key `deleteStatus` later
// publishes its Tombstone fan-out under, and the delete was silently dropped
// as a duplicate. The `inbox:` prefix puts every id derived from remote input
// in its own namespace: internal inputs are URLs or fixed formats, never
// strings starting with `inbox:`. Every inbox-derived job id goes through here.
export const getInboxJobId = (activityId: string, suffix = '') =>
  getHashFromString(`inbox:${activityId}${suffix}`)
