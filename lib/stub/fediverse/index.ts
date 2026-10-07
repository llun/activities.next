import { FetchMock } from 'jest-fetch-mock'

import funkwhaleAudio from './funkwhale/audio.json'
import funkwhaleCreateAudio from './funkwhale/create-audio.json'
import funkwhalePerson from './funkwhale/person.json'
import gotosocialCreateNote from './gotosocial/create-note.json'
import gotosocialFollow from './gotosocial/follow.json'
import gotosocialLike from './gotosocial/like.json'
import gotosocialNote from './gotosocial/note.json'
import gotosocialOutboxPage from './gotosocial/outbox-page.json'
import gotosocialOutbox from './gotosocial/outbox.json'
import gotosocialPersonTurtle from './gotosocial/person-turtle.json'
import gotosocialPerson from './gotosocial/person.json'
import gotosocialRepliesPage from './gotosocial/replies-page.json'
import gotosocialReply from './gotosocial/reply.json'
import lemmyAnnounceCreatePage from './lemmy/announce-create-page.json'
import lemmyAnnounceLike from './lemmy/announce-like.json'
import lemmyComment from './lemmy/comment.json'
import lemmyCreatePage from './lemmy/create-page.json'
import lemmyGroupOutbox from './lemmy/group-outbox.json'
import lemmyGroup from './lemmy/group.json'
import lemmyLike from './lemmy/like.json'
import lemmyPage from './lemmy/page.json'
import lemmyPerson from './lemmy/person.json'
import misskeyCreateNote from './misskey/create-note.json'
import misskeyFollow from './misskey/follow.json'
import misskeyNote from './misskey/note.json'
import misskeyOutboxPage from './misskey/outbox-page.json'
import misskeyOutbox from './misskey/outbox.json'
import misskeyPerson from './misskey/person.json'
import misskeyReactionCustomEmoji from './misskey/reaction-custom-emoji.json'
import misskeyReaction from './misskey/reaction.json'
import misskeyRenote from './misskey/renote.json'
import mobilizonCreateEvent from './mobilizon/create-event.json'
import mobilizonEvent from './mobilizon/event.json'
import mobilizonPerson from './mobilizon/person.json'
import peertubeAnnounceVideo from './peertube/announce-video.json'
import peertubeChannelOutboxPage from './peertube/channel-outbox-page.json'
import peertubeChannelOutbox from './peertube/channel-outbox.json'
import peertubeCreateComment from './peertube/create-comment.json'
import peertubeCreateVideo from './peertube/create-video.json'
import peertubeFollow from './peertube/follow.json'
import peertubeGroup from './peertube/group.json'
import peertubePerson from './peertube/person.json'
import peertubeVideo from './peertube/video.json'
import pixelfedAnnounce from './pixelfed/announce.json'
import pixelfedCreateNote from './pixelfed/create-note.json'
import pixelfedFollow from './pixelfed/follow.json'
import pixelfedLike from './pixelfed/like.json'
import pixelfedNote from './pixelfed/note.json'
import pixelfedOutbox from './pixelfed/outbox.json'
import pixelfedPerson from './pixelfed/person.json'
import pleromaAnnounce from './pleroma/announce.json'
import pleromaCreateChatMessage from './pleroma/create-chat-message.json'
import pleromaCreateNote from './pleroma/create-note.json'
import pleromaEmojiReactCustom from './pleroma/emoji-react-custom.json'
import pleromaEmojiReact from './pleroma/emoji-react.json'
import pleromaFollow from './pleroma/follow.json'
import pleromaNote from './pleroma/note.json'
import pleromaPerson from './pleroma/person.json'
import pleromaReply from './pleroma/reply.json'
import pleromaUndoEmojiReact from './pleroma/undo-emoji-react.json'

// Payloads in the shapes Misskey, Lemmy, PeerTube, Pixelfed, Pleroma/Akkoma,
// GoToSocial, Funkwhale and Mobilizon put on the wire, kept here so the inbox
// and remote-fetch paths are exercised against every dialect rather than only
// Mastodon's. Hosts are rewritten to `<software>.test` (`gts.test` for
// GoToSocial); interaction targets point at the seeded local status
// `https://llun.test/users/test1/statuses/post-1`.

export type FediverseSoftware =
  | 'misskey'
  | 'lemmy'
  | 'peertube'
  | 'pixelfed'
  | 'pleroma'
  | 'gotosocial'
  | 'funkwhale'
  | 'mobilizon'

type Document = { id: string } & Record<string, unknown>

export const FEDIVERSE_ACTORS = {
  misskey: misskeyPerson,
  lemmy: lemmyPerson,
  lemmyGroup: lemmyGroup,
  peertube: peertubePerson,
  peertubeChannel: peertubeGroup,
  pixelfed: pixelfedPerson,
  pleroma: pleromaPerson,
  gotosocial: gotosocialPerson,
  gotosocialTurtle: gotosocialPersonTurtle,
  funkwhale: funkwhalePerson,
  mobilizon: mobilizonPerson
}

export const FEDIVERSE_OBJECTS = {
  misskeyNote,
  lemmyPage,
  lemmyComment,
  peertubeVideo,
  pixelfedNote,
  pleromaNote,
  pleromaReply,
  gotosocialNote,
  gotosocialReply,
  funkwhaleAudio,
  mobilizonEvent
}

export const FEDIVERSE_COLLECTIONS = {
  misskeyOutbox,
  misskeyOutboxPage,
  lemmyGroupOutbox,
  peertubeChannelOutbox,
  peertubeChannelOutboxPage,
  pixelfedOutbox,
  gotosocialOutbox,
  gotosocialOutboxPage,
  gotosocialRepliesPage
}

// Inbound activities, as each server delivers them to an inbox.
export const FEDIVERSE_ACTIVITIES = {
  misskeyCreateNote,
  misskeyRenote,
  misskeyReaction,
  misskeyReactionCustomEmoji,
  lemmyCreatePage,
  lemmyAnnounceCreatePage,
  lemmyAnnounceLike,
  lemmyLike,
  peertubeCreateVideo,
  peertubeAnnounceVideo,
  peertubeCreateComment,
  pixelfedCreateNote,
  pixelfedAnnounce,
  pixelfedLike,
  pleromaCreateNote,
  pleromaAnnounce,
  pleromaEmojiReact,
  pleromaEmojiReactCustom,
  pleromaUndoEmojiReact,
  pleromaCreateChatMessage,
  gotosocialCreateNote,
  gotosocialLike,
  funkwhaleCreateAudio,
  mobilizonCreateEvent
}

// Follows of the seeded local actor `https://llun.test/users/test1`.
export const FEDIVERSE_FOLLOWS = {
  misskeyFollow,
  peertubeFollow,
  pixelfedFollow,
  pleromaFollow,
  gotosocialFollow
}

const FETCHABLE_DOCUMENTS: Document[] = [
  ...Object.values(FEDIVERSE_ACTORS),
  ...Object.values(FEDIVERSE_OBJECTS),
  ...Object.values(FEDIVERSE_COLLECTIONS)
]

const DOCUMENTS_BY_ID = new Map<string, Document>(
  FETCHABLE_DOCUMENTS.map((document) => [document.id, document])
)

// `acct:<preferredUsername>@<host>` → actor id, the way each server's
// WebFinger answers for its own actors (Lemmy communities included).
const WEBFINGER_ACCOUNTS = new Map<string, string>(
  Object.values(FEDIVERSE_ACTORS).map((actor) => [
    `${actor.preferredUsername}@${new URL(actor.id).host}`,
    actor.id
  ])
)

export const getFediverseDocument = (id: string) => DOCUMENTS_BY_ID.get(id)

const ACTIVITY_JSON_CONTENT_TYPE =
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'

/**
 * Serves every fixture document at its own `id`, plus WebFinger for every
 * fixture actor, from a jest-fetch-mock. Anything else is a 404 so a test
 * notices an unexpected fetch instead of silently reading a stub.
 */
export const mockFediverseRequests = (fetchMock: FetchMock) => {
  fetchMock.mockResponse(async (req) => {
    const url = new URL(req.url)
    if (req.method !== 'GET') return { status: 202, body: '' }

    if (url.pathname === '/.well-known/webfinger') {
      const account =
        url.searchParams.get('resource')?.replace(/^acct:/, '') ?? ''
      const actorId = WEBFINGER_ACCOUNTS.get(account)
      if (!actorId) return { status: 404, body: '' }
      return {
        status: 200,
        headers: { 'content-type': 'application/jrd+json; charset=utf-8' },
        body: JSON.stringify({
          subject: `acct:${account}`,
          aliases: [actorId],
          links: [
            {
              rel: 'self',
              type: 'application/activity+json',
              href: actorId
            }
          ]
        })
      }
    }

    const document = DOCUMENTS_BY_ID.get(req.url)
    if (!document) return { status: 404, body: '' }
    return {
      status: 200,
      headers: { 'content-type': ACTIVITY_JSON_CONTENT_TYPE },
      body: JSON.stringify(document)
    }
  })
}
