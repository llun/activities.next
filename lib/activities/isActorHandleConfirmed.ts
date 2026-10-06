import { getWebfingerDocument } from '@/lib/activities/getWebfingerDocument'
import { normalizeActivityPubUri } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

// An actor document names its own handle: `preferredUsername` plus the host of
// its `id`. Serving it from that host proves only that the host served SOME
// document — any URL there can claim any username on it (a JSON upload on a
// Pleroma/Akkoma media path, for one). Before a remote actor row is created,
// ask the host itself who `preferredUsername@host` is: its WebFinger `self`
// link must name this very actor id. Mastodon does the same before it records
// an account.
//
// The query goes to the host of the actor id, because that is the domain the
// row is stored under. A split-domain deployment (handle on `example.com`,
// actors on `social.example.com`) still confirms: Mastodon, GoToSocial,
// Pleroma/Akkoma and this server all answer WebFinger on the actor host for
// `user@<actor host>` too, with the same `self` link. Mastodon goes on to follow
// a differing `subject` because it stores the subject's domain; this server
// stores the actor host, so the actor host's own answer is the one that counts.
export const isActorHandleConfirmed = async ({
  actorId,
  username,
  withNetworkRetry = true,
  responseTimeout
}: {
  actorId: string
  username: string
  withNetworkRetry?: boolean
  responseTimeout?: number
}): Promise<boolean> => {
  const host = URL.canParse(actorId) ? new URL(actorId).host : ''
  if (!host) return false
  const expectedId = normalizeActivityPubUri(actorId)
  const account = `${username}@${host}`
  const document = await getWebfingerDocument({
    account,
    withNetworkRetry,
    responseTimeout
  })
  const selfHrefs =
    document?.links.flatMap((link) =>
      link.rel === 'self' && 'href' in link ? [link.href] : []
    ) ?? []
  const confirmed = selfHrefs.some(
    (href) => normalizeActivityPubUri(href) === expectedId
  )
  if (!confirmed) {
    logger.warn({
      message: 'Refused remote actor whose handle WebFinger does not confirm',
      actorId,
      account,
      webfingerSelf: document ? selfHrefs : null
    })
  }
  return confirmed
}
