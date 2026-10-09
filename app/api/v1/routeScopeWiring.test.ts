import { globSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { UsableScopes } from '@/lib/types/database/operations'

// Pins how each OAuth-guarded route is guarded, so a route's own tests need
// not re-prove it. TypeScript accepts any Scope.enum member and any of the four
// guard factories, so a wrong scope literal (block listing with write:mutes),
// an all-of guard where clients hold only a granular scope, or an optional
// guard that serves anonymous callers all compile and pass every other test.
// Each route module is imported with the guard factories mocked to tag the
// handler they return; the assertions read those tags off the exported methods.

type GuardKind =
  | 'OAuthGuard' // requires every listed scope
  | 'OAuthGuardAnyScope' // requires one listed scope
  | 'OptionalOAuthGuard:any'
  | 'OptionalOAuthGuard:all'
  | 'OAuthAppGuard:any'
  | 'OAuthAppGuard:all'

type TaggedHandler = {
  __scopes?: string[]
  __guard?: GuardKind
  __unconfirmedAccount?: unknown
}

vi.mock('@/lib/services/guards/OAuthGuard', () => {
  // OAuthGuard and OAuthGuardAnyScope fix their match mode; the optional and
  // app guards take it from `options.matchMode` and default to all-of.
  const tag =
    (factory: string, fixedMatch?: 'any' | 'all') =>
    (
      scopes: string[],
      _handle: unknown,
      options: { matchMode?: 'any' | 'all'; unconfirmedAccount?: unknown } = {}
    ) =>
      Object.assign(() => new Response(null), {
        __scopes: scopes,
        __guard: fixedMatch
          ? factory
          : `${factory}:${options.matchMode ?? 'all'}`,
        __unconfirmedAccount: options.unconfirmedAccount
      })
  return {
    OAuthGuard: tag('OAuthGuard', 'all'),
    OAuthGuardAnyScope: tag('OAuthGuardAnyScope', 'any'),
    OptionalOAuthGuard: tag('OptionalOAuthGuard'),
    OAuthAppGuard: tag('OAuthAppGuard'),
    corsErrorResponse: () => () => new Response(null)
  }
})

// Pass traceApiRoute through so each exported method IS the tagged guard handler.
vi.mock('@/lib/utils/traceApiRoute', () => ({
  traceApiRoute: (_name: string, handler: unknown) => handler
}))

// Route module -> the exact set of scope strings it should pass across all its
// guarded methods (deduped), and the guard it uses. `guard` defaults to
// OAuthGuardAnyScope, which most Mastodon routes use (the aggregate scope or the
// granular one); give it per method when a route mixes guards. Kept independent
// of the route source so a wrong literal or guard is caught.
const DEFAULT_GUARD: GuardKind = 'OAuthGuardAnyScope'
const EXPECTED: Array<{
  module: string
  scopes: string[]
  guard?: GuardKind | Partial<Record<string, GuardKind>>
  unconfirmedAccount?: 'allow'
}> = [
  // status emoji reactions (ecosystem dialects, one store)
  {
    module: '@/app/api/v1/pleroma/statuses/[id]/reactions/[emoji]/route',
    scopes: ['read', 'read:statuses', 'write', 'write:favourites'],
    guard: { GET: 'OptionalOAuthGuard:any' }
  },
  {
    module: '@/app/api/v1/pleroma/statuses/[id]/reactions/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/statuses/[id]/react/[name]/route',
    scopes: ['write', 'write:favourites']
  },
  {
    module: '@/app/api/v1/statuses/[id]/unreact/[name]/route',
    scopes: ['write', 'write:favourites']
  },
  // account actions
  {
    module: '@/app/api/v1/accounts/[id]/follow/route',
    scopes: ['write', 'write:follows']
  },
  {
    module: '@/app/api/v1/accounts/[id]/unfollow/route',
    scopes: ['write', 'write:follows']
  },
  {
    module: '@/app/api/v1/accounts/[id]/block/route',
    scopes: ['write', 'write:blocks']
  },
  {
    module: '@/app/api/v1/accounts/[id]/unblock/route',
    scopes: ['write', 'write:blocks']
  },
  {
    module: '@/app/api/v1/accounts/[id]/mute/route',
    scopes: ['write', 'write:mutes']
  },
  {
    module: '@/app/api/v1/accounts/[id]/unmute/route',
    scopes: ['write', 'write:mutes']
  },
  {
    module: '@/app/api/v1/accounts/[id]/note/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/accounts/[id]/collections/route',
    scopes: ['read', 'read:collections'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/endorse/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/accounts/[id]/endorsements/route',
    scopes: ['read', 'read:accounts'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/featured_tags/route',
    scopes: ['read', 'read:accounts'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/followers/route',
    scopes: ['read', 'read:follows'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/following/route',
    scopes: ['read', 'read:follows'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/in_collections/route',
    scopes: ['read', 'read:collections']
  },
  {
    module: '@/app/api/v1/accounts/[id]/lists/route',
    scopes: ['read', 'read:lists']
  },
  {
    module: '@/app/api/v1/accounts/[id]/media/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/pin/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/accounts/[id]/remote-statuses/route',
    scopes: ['read'],
    guard: 'OAuthGuard'
  },
  {
    module: '@/app/api/v1/accounts/[id]/remove_from_followers/route',
    scopes: ['write', 'write:follows']
  },
  {
    module: '@/app/api/v1/accounts/[id]/route',
    scopes: ['read', 'read:accounts'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/statuses/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/unendorse/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/accounts/[id]/unpin/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/accounts/search/route',
    scopes: ['read', 'read:accounts', 'read:search']
  },
  {
    module: '@/app/api/v1/accounts/update_credentials/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/accounts/verify_credentials/route',
    scopes: ['profile', 'read', 'read:accounts']
  },
  {
    module: '@/app/api/v1/follow_requests/count/route',
    scopes: ['read'],
    guard: 'OAuthGuard'
  },
  {
    module: '@/app/api/v1/profile/avatar/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/profile/header/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/profile/route',
    scopes: ['profile', 'read', 'read:accounts', 'write', 'write:accounts']
  },
  // status actions
  {
    module: '@/app/api/v1/statuses/[id]/favourite/route',
    scopes: ['write', 'write:favourites']
  },
  {
    module: '@/app/api/v1/statuses/[id]/unfavourite/route',
    scopes: ['write', 'write:favourites']
  },
  {
    module: '@/app/api/v1/statuses/[id]/reblog/route',
    scopes: ['write', 'write:statuses']
  },
  {
    module: '@/app/api/v1/statuses/[id]/unreblog/route',
    scopes: ['write', 'write:statuses']
  },
  {
    module: '@/app/api/v1/statuses/[id]/reblogged_by/route',
    scopes: ['read', 'read:accounts'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/statuses/[id]/favourited_by/route',
    scopes: ['read', 'read:accounts'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/statuses/[id]/bookmark/route',
    scopes: ['write', 'write:bookmarks']
  },
  {
    module: '@/app/api/v1/statuses/[id]/unbookmark/route',
    scopes: ['write', 'write:bookmarks']
  },
  {
    module: '@/app/api/v1/statuses/[id]/mute/route',
    scopes: ['write', 'write:mutes']
  },
  {
    module: '@/app/api/v1/statuses/[id]/unmute/route',
    scopes: ['write', 'write:mutes']
  },
  {
    module: '@/app/api/v1/statuses/[id]/pin/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/statuses/[id]/unpin/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module:
      '@/app/api/v1/statuses/[id]/quotes/[quoting_status_id]/revoke/route',
    scopes: ['write', 'write:statuses']
  },
  {
    module: '@/app/api/v1/statuses/[id]/quotes/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/statuses/[id]/interaction_policy/route',
    scopes: ['write', 'write:statuses']
  },
  {
    module: '@/app/api/v1/statuses/[id]/source/route',
    scopes: ['read', 'read:statuses']
  },
  {
    module: '@/app/api/v1/statuses/[id]/translate/route',
    scopes: ['read', 'read:statuses']
  },
  {
    module: '@/app/api/v1/statuses/[id]/context/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/statuses/[id]/history/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/statuses/[id]/route',
    scopes: ['read', 'read:statuses', 'write', 'write:statuses'],
    guard: { GET: 'OptionalOAuthGuard:any' }
  },
  {
    module: '@/app/api/v1/statuses/route',
    scopes: ['read', 'read:statuses', 'write', 'write:statuses'],
    guard: { GET: 'OptionalOAuthGuard:any' }
  },
  {
    module: '@/app/api/v1/statuses/[id]/retry-fitness/route',
    scopes: ['write'],
    guard: 'OAuthGuard'
  },
  // scheduled statuses
  {
    module: '@/app/api/v1/scheduled_statuses/route',
    scopes: ['read', 'read:statuses']
  },
  {
    module: '@/app/api/v1/scheduled_statuses/[id]/route',
    scopes: ['read', 'read:statuses', 'write', 'write:statuses']
  },
  // polls
  {
    module: '@/app/api/v1/polls/[id]/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/polls/[id]/votes/route',
    scopes: ['write', 'write:statuses']
  },
  // preferences
  {
    module: '@/app/api/v1/preferences/route',
    scopes: ['read', 'read:accounts']
  },
  // announcements
  {
    module: '@/app/api/v1/announcements/[id]/dismiss/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/announcements/[id]/reactions/[name]/route',
    scopes: ['write', 'write:favourites']
  },
  // suggestions (Mastodon: read)
  { module: '@/app/api/v1/suggestions/[account_id]/route', scopes: ['read'] },
  // v1 notifications
  {
    module: '@/app/api/v1/notifications/route',
    scopes: ['read', 'read:notifications', 'write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/clear/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/read/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/unread_count/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v1/notifications/[id]/route',
    scopes: ['read', 'read:notifications', 'write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/[id]/dismiss/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/merged/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/accept/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/dismiss/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/[id]/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/[id]/accept/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/requests/[id]/dismiss/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v1/notifications/policy/route',
    scopes: ['read', 'read:notifications', 'write', 'write:notifications']
  },
  // v2 notifications
  {
    module: '@/app/api/v2/notifications/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v2/notifications/unread_count/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v2/notifications/policy/route',
    scopes: ['read', 'read:notifications', 'write', 'write:notifications']
  },
  {
    module: '@/app/api/v2/notifications/[group_key]/route',
    scopes: ['read', 'read:notifications']
  },
  {
    module: '@/app/api/v2/notifications/[group_key]/accounts/route',
    scopes: ['write', 'write:notifications']
  },
  {
    module: '@/app/api/v2/notifications/[group_key]/dismiss/route',
    scopes: ['write', 'write:notifications']
  },
  // userinfo
  {
    module: '@/app/api/oauth/userinfo/route',
    scopes: ['openid', 'profile', 'read']
  },
  // follow_requests authorize/reject
  {
    module: '@/app/api/v1/follow_requests/[id]/authorize/route',
    scopes: ['write', 'write:follows']
  },
  {
    module: '@/app/api/v1/follow_requests/[id]/reject/route',
    scopes: ['write', 'write:follows']
  },
  // account lists and relationships
  {
    module: '@/app/api/v1/accounts/familiar_followers/route',
    scopes: ['read', 'read:follows']
  },
  {
    module: '@/app/api/v1/accounts/relationships/route',
    scopes: ['read', 'read:follows']
  },
  { module: '@/app/api/v1/blocks/route', scopes: ['read', 'read:blocks'] },
  { module: '@/app/api/v1/mutes/route', scopes: ['read', 'read:mutes'] },
  {
    module: '@/app/api/v1/follow_requests/route',
    scopes: ['read', 'read:follows']
  },
  {
    module: '@/app/api/v1/domain_blocks/route',
    scopes: ['read', 'read:blocks', 'write', 'write:blocks']
  },
  {
    module: '@/app/api/v1/endorsements/route',
    scopes: ['read', 'read:accounts']
  },
  {
    module: '@/app/api/v1/bookmarks/route',
    scopes: ['read', 'read:bookmarks']
  },
  {
    module: '@/app/api/v1/favourites/route',
    scopes: ['read', 'read:favourites']
  },
  {
    module: '@/app/api/v1/markers/route',
    scopes: ['read', 'read:statuses', 'write', 'write:statuses']
  },
  // featured tags
  {
    module: '@/app/api/v1/featured_tags/route',
    scopes: ['read', 'read:accounts', 'write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/featured_tags/suggestions/route',
    scopes: ['read', 'read:accounts']
  },
  {
    module: '@/app/api/v1/tags/[tag]/feature/route',
    scopes: ['write', 'write:accounts']
  },
  {
    module: '@/app/api/v1/tags/[tag]/unfeature/route',
    scopes: ['write', 'write:accounts']
  },
  // media
  { module: '@/app/api/v1/media/route', scopes: ['write', 'write:media'] },
  { module: '@/app/api/v1/media/[id]/route', scopes: ['write', 'write:media'] },
  {
    module: '@/app/api/v1/media/[id]/describe/route',
    scopes: ['write', 'write:media']
  },
  {
    module: '@/app/api/v1/media/[id]/lookups/route',
    scopes: ['write', 'write:media']
  },
  {
    module: '@/app/api/v1/media/[id]/subject-suggestions/route',
    scopes: ['write', 'write:media']
  },
  {
    module: '@/app/api/v1/gallery/media/[mediaId]/details/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/gallery/media/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/gallery/subjects/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/gallery/life-list/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/gallery/map/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/gallery/albums/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  {
    module: '@/app/api/v1/accounts/[id]/gallery/albums/[albumId]/route',
    scopes: ['read', 'read:statuses'],
    guard: 'OptionalOAuthGuard:any'
  },
  // gallery albums (owner only)
  {
    module: '@/app/api/v1/gallery/albums/route',
    scopes: ['read', 'read:statuses', 'write', 'write:media']
  },
  {
    module: '@/app/api/v1/gallery/albums/[id]/route',
    scopes: ['read', 'read:statuses', 'write', 'write:media']
  },
  {
    module: '@/app/api/v1/gallery/albums/[id]/items/route',
    scopes: ['read', 'read:statuses', 'write', 'write:media']
  },
  { module: '@/app/api/v2/media/route', scopes: ['write', 'write:media'] },
  // announcements and suggestions lists
  {
    module: '@/app/api/v1/announcements/route',
    scopes: ['read'],
    guard: 'OAuthGuard'
  },
  {
    module: '@/app/api/v1/suggestions/route',
    scopes: ['read'],
    guard: 'OAuthGuard'
  },
  {
    module: '@/app/api/v2/suggestions/route',
    scopes: ['read'],
    guard: 'OAuthGuard'
  },
  // filters v1
  {
    module: '@/app/api/v1/filters/route',
    scopes: ['read', 'read:filters', 'write:filters'],
    guard: { POST: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v1/filters/[id]/route',
    scopes: ['read', 'read:filters', 'write:filters'],
    guard: { PUT: 'OAuthGuard', PATCH: 'OAuthGuard', DELETE: 'OAuthGuard' }
  },
  // filters v2
  {
    module: '@/app/api/v2/filters/route',
    scopes: ['read', 'read:filters', 'write:filters'],
    guard: { POST: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v2/filters/[id]/route',
    scopes: ['read', 'read:filters', 'write:filters'],
    guard: { PUT: 'OAuthGuard', PATCH: 'OAuthGuard', DELETE: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v2/filters/[id]/keywords/route',
    scopes: ['read', 'read:filters', 'write:filters'],
    guard: { POST: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v2/filters/keywords/[id]/route',
    scopes: ['read', 'read:filters', 'write:filters'],
    guard: { PUT: 'OAuthGuard', PATCH: 'OAuthGuard', DELETE: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v2/filters/[id]/statuses/route',
    scopes: ['read', 'read:filters', 'write:filters'],
    guard: { POST: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v2/filters/statuses/[id]/route',
    scopes: ['read', 'read:filters', 'write:filters'],
    guard: { DELETE: 'OAuthGuard' }
  },
  // collections
  {
    module: '@/app/api/v1/collections/route',
    scopes: ['read', 'read:collections', 'write:collections'],
    guard: { POST: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v1/collections/[id]/route',
    scopes: ['read', 'read:collections', 'write:collections'],
    guard: {
      GET: 'OptionalOAuthGuard:any',
      PATCH: 'OAuthGuard',
      DELETE: 'OAuthGuard'
    }
  },
  {
    module: '@/app/api/v1/collections/[id]/feed/route',
    scopes: ['read'],
    guard: 'OptionalOAuthGuard:all'
  },
  {
    module: '@/app/api/v1/collections/[id]/items/route',
    scopes: ['read', 'read:collections', 'write:collections'],
    guard: { POST: 'OAuthGuard', DELETE: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v1/collections/[id]/items/[item_id]/route',
    scopes: ['write:collections'],
    guard: 'OAuthGuard'
  },
  {
    module: '@/app/api/v1/collections/[id]/items/[item_id]/approve/route',
    scopes: ['write:collections'],
    guard: 'OAuthGuard'
  },
  {
    module: '@/app/api/v1/collections/[id]/items/[item_id]/revoke/route',
    scopes: ['write:collections'],
    guard: 'OAuthGuard'
  },
  // lists
  {
    module: '@/app/api/v1/lists/route',
    scopes: ['read', 'read:lists', 'write:lists'],
    guard: { POST: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v1/lists/[id]/route',
    scopes: ['read', 'read:lists', 'write:lists'],
    guard: { PUT: 'OAuthGuard', DELETE: 'OAuthGuard' }
  },
  {
    module: '@/app/api/v1/lists/[id]/accounts/route',
    scopes: ['read', 'read:lists', 'write:lists'],
    guard: { POST: 'OAuthGuard', DELETE: 'OAuthGuard' }
  },
  // apps
  {
    module: '@/app/api/v1/apps/verify_credentials/route',
    scopes: [...UsableScopes],
    guard: 'OAuthAppGuard:any'
  },
  // conversations
  {
    module: '@/app/api/v1/conversations/route',
    scopes: ['read', 'read:conversations', 'read:statuses']
  },
  {
    module: '@/app/api/v1/conversations/[id]/route',
    scopes: ['write', 'write:conversations']
  },
  {
    module: '@/app/api/v1/conversations/[id]/read/route',
    scopes: ['write', 'write:conversations']
  },
  {
    module: '@/app/api/v1/conversations/[id]/statuses/route',
    scopes: ['read', 'read:conversations', 'read:statuses']
  },
  // directory
  {
    module: '@/app/api/v1/directory/route',
    scopes: ['read'],
    guard: 'OptionalOAuthGuard:all'
  },
  // email confirmations (only route that opts into unconfirmedAccount)
  {
    module: '@/app/api/v1/emails/confirmations/route',
    scopes: ['write', 'write:accounts'],
    unconfirmedAccount: 'allow'
  },
  // featured tags
  {
    module: '@/app/api/v1/featured_tags/[id]/route',
    scopes: ['write', 'write:accounts']
  },
  // followed tags
  {
    module: '@/app/api/v1/followed_tags/route',
    scopes: ['read', 'read:follows']
  },
  // web push
  {
    module: '@/app/api/v1/push/subscribe/route',
    scopes: ['push'],
    guard: 'OAuthGuard'
  },
  {
    module: '@/app/api/v1/push/subscription/route',
    scopes: ['push'],
    guard: 'OAuthGuard'
  },
  // reports
  {
    module: '@/app/api/v1/reports/route',
    scopes: ['write:reports'],
    guard: 'OAuthGuard'
  },
  // tags
  {
    module: '@/app/api/v1/tags/[tag]/route',
    scopes: ['read'],
    guard: 'OptionalOAuthGuard:all'
  },
  {
    module: '@/app/api/v1/tags/[tag]/follow/route',
    scopes: ['write:follows'],
    guard: 'OAuthGuard'
  },
  {
    module: '@/app/api/v1/tags/[tag]/unfollow/route',
    scopes: ['write:follows'],
    guard: 'OAuthGuard'
  },
  // timelines
  {
    module: '@/app/api/v1/timelines/[timeline]/route',
    scopes: ['read', 'read:statuses']
  },
  {
    module: '@/app/api/v1/timelines/collection/[id]/route',
    scopes: ['read', 'read:collections']
  },
  {
    module: '@/app/api/v1/timelines/list/[list_id]/route',
    scopes: ['read', 'read:lists']
  },
  {
    module: '@/app/api/v1/timelines/public/route',
    scopes: ['read'],
    guard: 'OptionalOAuthGuard:all'
  },
  {
    module: '@/app/api/v1/timelines/tag/[hashtag]/route',
    scopes: ['read'],
    guard: 'OptionalOAuthGuard:all'
  },
  // trends
  {
    module: '@/app/api/v1/trends/route',
    scopes: ['read'],
    guard: 'OptionalOAuthGuard:all'
  },
  {
    module: '@/app/api/v1/trends/links/route',
    scopes: ['read'],
    guard: 'OptionalOAuthGuard:all'
  },
  {
    module: '@/app/api/v1/trends/statuses/route',
    scopes: ['read'],
    guard: 'OptionalOAuthGuard:all'
  },
  {
    module: '@/app/api/v1/trends/tags/route',
    scopes: ['read'],
    guard: 'OptionalOAuthGuard:all'
  },
  // search v2
  {
    module: '@/app/api/v2/search/route',
    scopes: ['read:search'],
    guard: 'OptionalOAuthGuard:all'
  }
]

const unique = (scopes: string[]) => [...new Set(scopes)].sort()

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

// Methods that reach a guard through their own code rather than being the
// guard's handler, so the per-method checks below cannot see it. Each is
// covered by its route's own tests instead.
const GUARDED_INDIRECTLY: Record<string, string[]> = {
  // OIDC Core 5.3.1: moves a form-body access_token into the Authorization
  // header, then delegates to the guarded GET handler.
  '@/app/api/oauth/userinfo/route': ['POST']
}

const expectedGuard = (
  guard: (typeof EXPECTED)[number]['guard'],
  method: string
): GuardKind =>
  (typeof guard === 'string' ? guard : guard?.[method]) ?? DEFAULT_GUARD

describe('OAuth scope guard wiring', () => {
  // Every exported method must be a guard's handler (a guarded GET beside an
  // unguarded POST would otherwise pass), with the expected guard, and none may
  // opt into `unconfirmedAccount`. Together with the scope literals, that lets
  // a route's own tests skip re-proving "401 without a session" and scope
  // acceptance, which OAuthGuard.test.ts covers once per guard kind (see
  // CONTRIBUTING.md -> Testing Guidelines).
  it.each(EXPECTED)(
    '$module guards every method with the expected guard and scopes',
    async ({ module, scopes, guard, unconfirmedAccount }) => {
      const mod = (await import(module)) as Record<string, TaggedHandler>
      const guarded = HTTP_METHODS.filter(
        (method) =>
          method in mod && !GUARDED_INDIRECTLY[module]?.includes(method)
      )
      expect(guarded.length).toBeGreaterThan(0)

      expect(
        guarded.filter((method) => !Array.isArray(mod[method]?.__scopes))
      ).toEqual([])
      expect(
        unique(guarded.flatMap((method) => mod[method]?.__scopes ?? []))
      ).toEqual(unique(scopes))
      expect(
        Object.fromEntries(
          guarded.map((method) => [method, mod[method]?.__guard])
        )
      ).toEqual(
        Object.fromEntries(
          guarded.map((method) => [method, expectedGuard(guard, method)])
        )
      )
      expect(
        guarded.filter(
          (method) => mod[method]?.__unconfirmedAccount !== unconfirmedAccount
        )
      ).toEqual([])
    }
  )
})

// The union assertion above cannot tell a GET<->mutation scope swap apart on
// multi-method routes (the flattened set is identical). Assert those routes
// per exported method. Both describes read tags off the exported handlers, so
// neither depends on which one imports a module first.
const MULTI_METHOD: Array<{
  module: string
  methods: Record<string, string[]>
}> = [
  {
    module: '@/app/api/v1/domain_blocks/route',
    methods: {
      GET: ['read', 'read:blocks'],
      POST: ['write', 'write:blocks'],
      DELETE: ['write', 'write:blocks']
    }
  },
  {
    module: '@/app/api/v1/featured_tags/route',
    methods: {
      GET: ['read', 'read:accounts'],
      POST: ['write', 'write:accounts']
    }
  },
  {
    module: '@/app/api/v1/markers/route',
    methods: {
      GET: ['read', 'read:statuses'],
      POST: ['write', 'write:statuses']
    }
  },
  {
    // Reads and writes on one reaction URL: a GET<->mutation scope swap here
    // would pass the flattened EXPECTED assertion above.
    module: '@/app/api/v1/pleroma/statuses/[id]/reactions/[emoji]/route',
    methods: {
      GET: ['read', 'read:statuses'],
      PUT: ['write', 'write:favourites'],
      DELETE: ['write', 'write:favourites']
    }
  },
  {
    module: '@/app/api/v1/notifications/route',
    methods: {
      GET: ['read', 'read:notifications'],
      POST: ['write', 'write:notifications']
    }
  },
  {
    module: '@/app/api/v1/notifications/[id]/route',
    methods: {
      GET: ['read', 'read:notifications'],
      POST: ['write', 'write:notifications']
    }
  },
  {
    module: '@/app/api/v2/notifications/policy/route',
    methods: {
      GET: ['read', 'read:notifications'],
      PUT: ['write', 'write:notifications'],
      PATCH: ['write', 'write:notifications']
    }
  },
  {
    module: '@/app/api/v1/notifications/policy/route',
    methods: {
      GET: ['read', 'read:notifications'],
      PUT: ['write', 'write:notifications'],
      PATCH: ['write', 'write:notifications']
    }
  },
  {
    module: '@/app/api/v1/statuses/[id]/route',
    methods: {
      GET: ['read', 'read:statuses'],
      PUT: ['write', 'write:statuses'],
      DELETE: ['write', 'write:statuses']
    }
  },
  {
    module: '@/app/api/v1/statuses/route',
    methods: {
      GET: ['read', 'read:statuses'],
      POST: ['write', 'write:statuses']
    }
  },
  {
    module: '@/app/api/v1/scheduled_statuses/[id]/route',
    methods: {
      GET: ['read', 'read:statuses'],
      PUT: ['write', 'write:statuses'],
      DELETE: ['write', 'write:statuses']
    }
  },
  {
    module: '@/app/api/v1/profile/route',
    methods: {
      GET: ['profile', 'read', 'read:accounts'],
      PATCH: ['write', 'write:accounts']
    }
  },
  {
    module: '@/app/api/v1/filters/route',
    methods: {
      GET: ['read', 'read:filters'],
      POST: ['write:filters']
    }
  },
  {
    module: '@/app/api/v1/filters/[id]/route',
    methods: {
      GET: ['read', 'read:filters'],
      PUT: ['write:filters'],
      PATCH: ['write:filters'],
      DELETE: ['write:filters']
    }
  },
  {
    module: '@/app/api/v2/filters/route',
    methods: {
      GET: ['read', 'read:filters'],
      POST: ['write:filters']
    }
  },
  {
    module: '@/app/api/v2/filters/[id]/route',
    methods: {
      GET: ['read', 'read:filters'],
      PUT: ['write:filters'],
      PATCH: ['write:filters'],
      DELETE: ['write:filters']
    }
  },
  {
    module: '@/app/api/v2/filters/[id]/keywords/route',
    methods: {
      GET: ['read', 'read:filters'],
      POST: ['write:filters']
    }
  },
  {
    module: '@/app/api/v2/filters/keywords/[id]/route',
    methods: {
      GET: ['read', 'read:filters'],
      PUT: ['write:filters'],
      PATCH: ['write:filters'],
      DELETE: ['write:filters']
    }
  },
  {
    module: '@/app/api/v2/filters/[id]/statuses/route',
    methods: {
      GET: ['read', 'read:filters'],
      POST: ['write:filters']
    }
  },
  {
    module: '@/app/api/v2/filters/statuses/[id]/route',
    methods: {
      GET: ['read', 'read:filters'],
      DELETE: ['write:filters']
    }
  },
  {
    module: '@/app/api/v1/collections/route',
    methods: {
      GET: ['read', 'read:collections'],
      POST: ['write:collections']
    }
  },
  {
    module: '@/app/api/v1/collections/[id]/route',
    methods: {
      GET: ['read', 'read:collections'],
      PATCH: ['write:collections'],
      DELETE: ['write:collections']
    }
  },
  {
    module: '@/app/api/v1/collections/[id]/items/route',
    methods: {
      GET: ['read', 'read:collections'],
      POST: ['write:collections'],
      DELETE: ['write:collections']
    }
  },
  {
    module: '@/app/api/v1/gallery/albums/route',
    methods: {
      GET: ['read', 'read:statuses'],
      POST: ['write', 'write:media']
    }
  },
  {
    module: '@/app/api/v1/gallery/albums/[id]/route',
    methods: {
      GET: ['read', 'read:statuses'],
      PATCH: ['write', 'write:media'],
      DELETE: ['write', 'write:media']
    }
  },
  {
    module: '@/app/api/v1/gallery/albums/[id]/items/route',
    methods: {
      GET: ['read', 'read:statuses'],
      POST: ['write', 'write:media'],
      DELETE: ['write', 'write:media']
    }
  },
  {
    module: '@/app/api/v1/lists/route',
    methods: {
      GET: ['read', 'read:lists'],
      POST: ['write:lists']
    }
  },
  {
    module: '@/app/api/v1/lists/[id]/route',
    methods: {
      GET: ['read', 'read:lists'],
      PUT: ['write:lists'],
      DELETE: ['write:lists']
    }
  },
  {
    module: '@/app/api/v1/lists/[id]/accounts/route',
    methods: {
      GET: ['read', 'read:lists'],
      POST: ['write:lists'],
      DELETE: ['write:lists']
    }
  }
]

describe('multi-method route scopes are wired per method', () => {
  it.each(MULTI_METHOD)('$module', async ({ module, methods }) => {
    const mod = (await import(module)) as Record<string, TaggedHandler>
    // Every guarded export must be pinned here: an unlisted PUT beside a
    // listed PATCH could carry read scopes without changing the union above.
    expect(Object.keys(methods).sort()).toEqual(
      HTTP_METHODS.filter(
        (method) =>
          method in mod && !GUARDED_INDIRECTLY[module]?.includes(method)
      ).sort()
    )
    for (const [method, scopes] of Object.entries(methods)) {
      expect(unique(mod[method]?.__scopes ?? [])).toEqual(unique(scopes))
    }
  })
})

// A route only gets the guarantees above if it is in EXPECTED, so find every
// route whose exported handlers carry a guard tag and require it to be listed.
// Detection imports the modules rather than scanning their text, because some
// routes get their guarded handler from a lib/ helper (the endorsement
// handlers) and never import the guard module themselves.
//
// Routes guarded before this check existed and not yet listed. The list may
// only shrink: add a new guarded route to EXPECTED, never here, and remove a
// route from here when it moves into EXPECTED. Until then, these routes rely on
// their own tests for their scopes and guard kind.
const UNLISTED_BASELINE: string[] = []

// Routes that build an OAuth guard inside their own exported function (at
// import time or per request), so no exported method carries the tag and the
// checks above cannot see the guard's scopes or kind. Each is pinned by the
// tests named beside it instead, and none may opt into `unconfirmedAccount`.
//
// They are found by source, not by import: a route counts when it, or a
// non-test module in its own directory, both references the guard module (by
// named, namespace or dynamic import, or a re-export) and names a guard
// factory. Lint forbids `../` imports, so that path always appears literally.
// Still invisible: a guard built per request by a module outside the route's
// directory (a lib/ helper that is not called at import time).
const GUARDED_BY_OWN_CODE: Record<string, string> = {
  // POST builds an OAuthAppGuard(['write:accounts']) for bearer registration.
  '@/app/api/v1/accounts/route':
    'app/api/v1/accounts/route.test.ts ("an app token without write:accounts", "an unrelated write scope", and "only granular write:accounts")',
  // GET builds an OptionalOAuthGuard([read, read:accounts], { matchMode: 'any' })
  // for remote lookups.
  '@/app/api/v1/accounts/lookup/route':
    'app/api/v1/accounts/lookup/route.test.ts ("read:accounts scope to remotely resolve" and "insufficient scope")'
}

const GUARD_MODULE = '@/lib/services/guards/OAuthGuard'
const GUARD_FACTORY =
  /\b(OAuthGuard|OAuthGuardAnyScope|OptionalOAuthGuard|OAuthAppGuard)\b/
const buildsGuard = (source: string) =>
  source.includes(GUARD_MODULE) &&
  GUARD_FACTORY.test(source.replaceAll(GUARD_MODULE, ''))

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

describe('every OAuth-guarded route is in EXPECTED', () => {
  it('matches the unlisted baseline exactly', async () => {
    const listed = new Set(EXPECTED.map(({ module }) => module))
    const files = globSync('app/**/route.{ts,tsx,js,jsx}', { cwd: ROOT })
    expect(files.length).toBeGreaterThan(0)

    const unlisted: string[] = []
    const guardedByOwnCode: string[] = []
    const ownCodeOptingIntoUnconfirmed: string[] = []
    for (const file of files) {
      const module = `@/${file.replace(/\.[jt]sx?$/, '')}`
      const mod = (await import(module)) as Record<string, TaggedHandler>
      const guarded = HTTP_METHODS.some((method) => mod[method]?.__guard)
      if (guarded) {
        if (!listed.has(module)) unlisted.push(module)
      } else {
        const dir = path.join(ROOT, path.dirname(file))
        const sources = readdirSync(dir)
          .filter(
            (name) => /\.[jt]sx?$/.test(name) && !/\.test\.[jt]sx?$/.test(name)
          )
          .map((name) => readFileSync(path.join(dir, name), 'utf8'))
        if (sources.some(buildsGuard)) {
          guardedByOwnCode.push(module)
          if (sources.some((source) => source.includes('unconfirmedAccount'))) {
            ownCodeOptingIntoUnconfirmed.push(module)
          }
        }
      }
    }
    expect(
      unlisted.sort(),
      'An OAuth-guarded route missing here belongs in EXPECTED (never the ' +
        'baseline); one listed here but no longer unlisted must leave the baseline'
    ).toEqual([...UNLISTED_BASELINE].sort())
    expect(
      guardedByOwnCode.sort(),
      'A route that builds an OAuth guard but exports no guarded handler ' +
        'must be in GUARDED_BY_OWN_CODE with the test that pins its scopes'
    ).toEqual(Object.keys(GUARDED_BY_OWN_CODE).sort())
    expect(
      ownCodeOptingIntoUnconfirmed,
      'A route that builds its own guard may not opt into unconfirmedAccount'
    ).toEqual([])
  })
})
