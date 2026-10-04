// What a Back control says. Its visible text is "Back" everywhere, except a
// Back that returns to a profile, which reads "Back to profile". Its accessible
// name always names the destination and contains the visible text (WCAG 2.5.3,
// Label in Name), so a screen reader hears where it goes: "Back to lists",
// "Back to profile, Anna Nowak", "Back to #running".
//
// A profile's name follows the visible text, "Back to profile, <name>", rather
// than wrapping it ("Back to <name>'s profile"): the visible words must appear
// in the name as written, or speech-control users saying "Back to profile"
// would not match it.
//
// `resolveBackDestination` names the page a history-based Back returns to from
// that page's pathname alone (see `inAppHistory`): section pages take their
// label from the navigation registry, a profile is named by its handle (the
// display name is not known from a pathname), and anything unrecognised falls
// back to "Back to previous page". It only names the page: the history Back is
// always `router.back()`, never a link built from the recorded pathname.
//
// No `'use client'` and no React: server pages build parent-route Backs from
// the same helpers.
import { getNavItem } from '@/lib/components/layout/nav-items'
import { isNavItemId } from '@/lib/services/navigation/navPreferences'
import type { NavItemId } from '@/lib/services/navigation/navPreferences'
import { EMOJI_SHORTCODE_REGEX } from '@/lib/utils/text/getEmojiTags'

export interface BackDestination {
  /** The visible text: `BACK_LABEL`, or `PROFILE_BACK_LABEL` for a profile. */
  label: string
  /** Names the destination; always contains `label`. */
  accessibleName: string
}

export const BACK_LABEL = 'Back'
const PROFILE_BACK_LABEL = 'Back to profile'

const PREVIOUS_PAGE_BACK: BackDestination = {
  label: BACK_LABEL,
  accessibleName: 'Back to previous page'
}

/** A Back to a section or page: visible "Back", named "Back to <name>". */
const backTo = (name: string): BackDestination => ({
  label: BACK_LABEL,
  accessibleName: `Back to ${name}`
})

/**
 * A Back to a profile: visible "Back to profile", named "Back to profile,
 * <name>" — the person's display name when the caller has it, otherwise their
 * `@user@domain`.
 */
export const profileBack = (name: string): BackDestination => ({
  label: PROFILE_BACK_LABEL,
  accessibleName: `${PROFILE_BACK_LABEL}, ${name}`
})

/**
 * A display name for `profileBack`, falling back to the full handle. Custom
 * emoji shortcodes (`:blobcat:`) are dropped: the name is spoken, and a screen
 * reader would read the colons and the code aloud.
 */
export const profileName = ({
  name,
  username,
  domain
}: {
  name?: string | null
  username: string
  domain: string
}) =>
  name?.replaceAll(EMOJI_SHORTCODE_REGEX, ' ').replace(/\s+/g, ' ').trim() ||
  `@${username}@${domain}`

const sectionBack = (id: NavItemId) => backTo(getNavItem(id).label)

const safeDecode = (segment: string) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

// `@user@domain`, exactly: the actor segment of a profile route.
const HANDLE_PATTERN = /^@[^@/\s]+@[^@/\s]+$/

export const resolveBackDestination = (
  pathname: string | null | undefined
): BackDestination => {
  if (!pathname || !pathname.startsWith('/')) return PREVIOUS_PAGE_BACK

  const segments = pathname.split('/').filter(Boolean).map(safeDecode)
  if (segments.some((segment) => segment === null)) return PREVIOUS_PAGE_BACK
  const [first, second, third] = segments as string[]

  if (!first) return sectionBack('timeline')

  if (first === 'lists') {
    return second && second !== 'new' ? backTo('list') : sectionBack('lists')
  }
  if (first === 'collections') {
    return second && second !== 'new'
      ? backTo('collection')
      : sectionBack('lists')
  }
  if (first === 'tags') {
    return second && !third ? backTo(`#${second}`) : PREVIOUS_PAGE_BACK
  }
  // Every other first segment that is a navigation item id (`/notifications`,
  // `/settings`, ...) is that section; the timeline is `/`, handled above.
  if (isNavItemId(first)) return sectionBack(first)

  if (HANDLE_PATTERN.test(first)) {
    if (!second) return profileBack(first)
    if (second === 'followers') return backTo(`${first}'s followers`)
    if (second === 'following') return backTo(`${first}'s following`)
    if (second === 'fitness') return backTo(`${first}'s fitness`)
    if (!third) return backTo('post')
  }

  return PREVIOUS_PAGE_BACK
}
