import { List } from '@/lib/types/domain/list'
import { ListEntity } from '@/lib/types/mastodon/list'

// Converts the internal List domain model into the Mastodon List entity.
// https://docs.joinmastodon.org/entities/List/
export const getMastodonList = (list: List): ListEntity => ({
  id: list.id,
  title: list.title,
  replies_policy: list.repliesPolicy,
  exclusive: list.exclusive
})
