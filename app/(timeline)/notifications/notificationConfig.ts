import {
  Activity,
  AtSign,
  Heart,
  Library,
  type LucideIcon,
  Quote,
  Repeat2,
  Reply,
  UserPlus,
  Users
} from 'lucide-react'

import type { NotificationType } from '@/lib/types/database/operations'

// How a notification row is laid out:
// - 'status'       — post-linking types (like/mention/reply/reblog). Line 1 is
//                    just the verb; the actor avatar + name move to their own
//                    line above the quoted post.
// - 'relationship' — follow / follow request. The actor name lives inline with
//                    the verb on line 1, followed by the handle + action buttons.
// - 'system'       — activity import. A bold headline on line 1 plus an inline
//                    activity card.
export type NotificationKind = 'status' | 'relationship' | 'system'

export interface NotificationTypeConfig {
  // Type badge glyph shown to the left of every row.
  icon: LucideIcon
  // Heart renders filled; the rest keep their outline stroke.
  iconFilled?: boolean
  // Tailwind classes for the badge background + glyph color (per-type accent).
  badgeClassName: string
  // The notification text shown on line 1. For status/relationship types it is
  // the verb phrase; for system types it is the full headline.
  verb: string
  kind: NotificationKind
}

const RELATIONSHIP_BADGE =
  'bg-[hsl(210_90%_96%)] text-[hsl(210_80%_45%)] dark:bg-[hsl(210_80%_45%/0.16)] dark:text-[hsl(210_75%_68%)]'
const PRIMARY_BADGE = 'bg-primary/[0.12] text-primary'

export const NOTIFICATION_TYPE_CONFIG: Record<
  NotificationType,
  NotificationTypeConfig
> = {
  follow_request: {
    icon: UserPlus,
    badgeClassName: RELATIONSHIP_BADGE,
    verb: 'requested to follow you',
    kind: 'relationship'
  },
  follow: {
    icon: UserPlus,
    badgeClassName: RELATIONSHIP_BADGE,
    verb: 'followed you',
    kind: 'relationship'
  },
  like: {
    icon: Heart,
    iconFilled: true,
    badgeClassName:
      'bg-[hsl(0_84%_60%/0.1)] text-[hsl(0_72%_51%)] dark:bg-[hsl(0_84%_60%/0.16)] dark:text-[hsl(0_84%_70%)]',
    verb: 'liked your post',
    kind: 'status'
  },
  mention: {
    icon: AtSign,
    badgeClassName: PRIMARY_BADGE,
    verb: 'mentioned you',
    kind: 'status'
  },
  reply: {
    icon: Reply,
    badgeClassName: PRIMARY_BADGE,
    verb: 'replied to your post',
    kind: 'status'
  },
  reblog: {
    icon: Repeat2,
    badgeClassName:
      'bg-[hsl(142_60%_36%/0.12)] text-[hsl(142_60%_36%)] dark:bg-[hsl(142_60%_45%/0.16)] dark:text-[hsl(142_55%_60%)]',
    verb: 'boosted your post',
    kind: 'status'
  },
  quote: {
    icon: Quote,
    badgeClassName:
      'bg-[hsl(142_60%_36%/0.12)] text-[hsl(142_60%_36%)] dark:bg-[hsl(142_60%_45%/0.16)] dark:text-[hsl(142_55%_60%)]',
    verb: 'quoted your post',
    kind: 'status'
  },
  activity_import: {
    icon: Activity,
    badgeClassName: PRIMARY_BADGE,
    verb: 'Your fitness activity is ready',
    kind: 'system'
  },
  added_to_collection: {
    icon: Users,
    badgeClassName: RELATIONSHIP_BADGE,
    verb: 'added you to a collection',
    kind: 'relationship'
  },
  collection_update: {
    icon: Library,
    badgeClassName: RELATIONSHIP_BADGE,
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
