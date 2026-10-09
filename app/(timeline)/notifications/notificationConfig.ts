import {
  Activity,
  AtSign,
  Heart,
  Library,
  type LucideIcon,
  PencilLine,
  Quote,
  Repeat2,
  Reply,
  Smile,
  UserPlus,
  Users,
  Wrench
} from 'lucide-react'

import type { NotificationType } from '@/lib/types/database/operations'

// How a notification row is laid out:
// - 'status'       — post-linking types (like/mention/reply/reblog). Line 1 is
//                    just the verb; the actor avatar + name move to their own
//                    line above the quoted post.
// - 'relationship' — follow / follow request. The actor name lives inline with
//                    the verb on line 1, followed by the handle + action buttons.
// - 'system'       — activity import. A bold headline on line 1 plus an inline
//                    activity card, and a fallback line when the status behind
//                    it is gone.
// - 'plain'        — a self-addressed notice about the account's own data, with
//                    no status and no other actor involved (gear service
//                    reminders). A bold headline plus a link to the surface it
//                    is about. Distinct from 'system' precisely because that
//                    branch treats a missing status as a deleted one.
export type NotificationKind = 'status' | 'relationship' | 'system' | 'plain'

export type NotificationBadgeTone =
  'primary' | 'success' | 'warning' | 'info' | 'destructive'

export interface NotificationTypeConfig {
  // Type badge glyph shown to the left of every row.
  icon: LucideIcon
  // Heart renders filled; the rest keep their outline stroke.
  iconFilled?: boolean
  // `Badge` tone for the glyph tile (per-type accent).
  badgeTone: NotificationBadgeTone
  // The notification text shown on line 1. For status/relationship types it is
  // the verb phrase; for system types it is the full headline.
  verb: string
  kind: NotificationKind
}

// The badge tints are `Badge`'s own tones, so the glyph tiles and the pills
// elsewhere share one set of fills.
const RELATIONSHIP_BADGE: NotificationBadgeTone = 'info'
const PRIMARY_BADGE: NotificationBadgeTone = 'primary'
const LIKE_BADGE: NotificationBadgeTone = 'destructive'
const BOOST_BADGE: NotificationBadgeTone = 'success'
const REACTION_BADGE: NotificationBadgeTone = 'warning'

export const NOTIFICATION_TYPE_CONFIG: Record<
  NotificationType,
  NotificationTypeConfig
> = {
  follow_request: {
    icon: UserPlus,
    badgeTone: RELATIONSHIP_BADGE,
    verb: 'requested to follow you',
    kind: 'relationship'
  },
  follow: {
    icon: UserPlus,
    badgeTone: RELATIONSHIP_BADGE,
    verb: 'followed you',
    kind: 'relationship'
  },
  like: {
    icon: Heart,
    iconFilled: true,
    badgeTone: LIKE_BADGE,
    verb: 'liked your post',
    kind: 'status'
  },
  mention: {
    icon: AtSign,
    badgeTone: PRIMARY_BADGE,
    verb: 'mentioned you',
    kind: 'status'
  },
  reply: {
    icon: Reply,
    badgeTone: PRIMARY_BADGE,
    verb: 'replied to your post',
    kind: 'status'
  },
  reblog: {
    icon: Repeat2,
    badgeTone: BOOST_BADGE,
    verb: 'boosted your post',
    kind: 'status'
  },
  quote: {
    icon: Quote,
    badgeTone: BOOST_BADGE,
    verb: 'quoted your post',
    kind: 'status'
  },
  quoted_update: {
    icon: PencilLine,
    badgeTone: PRIMARY_BADGE,
    verb: 'edited a post you quoted',
    kind: 'status'
  },
  emoji_reaction: {
    icon: Smile,
    badgeTone: REACTION_BADGE,
    verb: 'reacted to your post',
    kind: 'status'
  },
  activity_import: {
    icon: Activity,
    badgeTone: PRIMARY_BADGE,
    verb: 'Your fitness activity is ready',
    kind: 'system'
  },
  gear_service_due: {
    icon: Wrench,
    badgeTone: PRIMARY_BADGE,
    verb: 'Your gear is due for service',
    kind: 'plain'
  },
  added_to_collection: {
    icon: Users,
    badgeTone: RELATIONSHIP_BADGE,
    verb: 'added you to a collection',
    kind: 'relationship'
  },
  collection_update: {
    icon: Library,
    badgeTone: RELATIONSHIP_BADGE,
    verb: 'updated a collection you’re in',
    kind: 'relationship'
  }
}

// "Ride", "Ride and 1 other", "Ride and 2 others" — collapses a grouped row's
// many actors down to the lead actor's name plus a count.
export const getGroupedName = (name: string, groupedCount?: number) => {
  const others = (groupedCount ?? 1) - 1
  if (others <= 0) return name
  return `${name} and ${others} ${others === 1 ? 'other' : 'others'}`
}

// Two-letter monogram for the avatar fallback: initials of the first two words,
// or the first two letters of a single-word name. Uses Array.from so emoji /
// multi-byte code points (common in Fediverse display names) are not split.
export const getInitials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) {
    return Array.from(words[0]).slice(0, 2).join('').toUpperCase()
  }
  const firstInitial = Array.from(words[0])[0] ?? ''
  const secondInitial = Array.from(words[1])[0] ?? ''
  return (firstInitial + secondInitial).toUpperCase()
}
