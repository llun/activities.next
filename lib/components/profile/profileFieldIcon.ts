export type ProfileFieldIconKind =
  'location' | 'image' | 'activity' | 'mail' | 'link' | 'text'

export interface ProfileFieldIconChoice {
  kind: ProfileFieldIconKind
  /** True when a keyword picked the icon, so the icon says what the label would. */
  specific: boolean
}

const LOCATION = /\b(location|based|home|city|lives?|living)/
const IMAGE =
  /\b(photo|photos|photography|gallery|flickr|pixelfed|instagram|500px)/
const ACTIVITY = /\b(strava|fitness|run|running|ride|riding|garmin|activity)/
const MAIL = /\b(mail|email|e-mail)/

const hrefOf = (value: string) =>
  /<a\s[^>]*?href\s*=\s*["']([^"']*)["']/i.exec(value)?.[1] ?? null

const hostOf = (href: string) => {
  if (/^mailto:/i.test(href)) return 'mailto'
  try {
    return new URL(href).hostname
  } catch {
    return href
  }
}

// Picks the icon of a profile field by a case-insensitive keyword match on the
// label and, for a link, its host. `value` is the field's HTML as stored.
export const chooseProfileFieldIcon = (
  label: string,
  value: string
): ProfileFieldIconChoice => {
  const href = hrefOf(value)
  const isLink = href !== null
  const labelText = label.toLowerCase()
  const haystack = `${labelText} ${href ? hostOf(href).toLowerCase() : ''}`

  if (LOCATION.test(labelText)) return { kind: 'location', specific: true }
  if (MAIL.test(labelText) || href?.toLowerCase().startsWith('mailto:'))
    return { kind: 'mail', specific: true }
  if (IMAGE.test(haystack)) return { kind: 'image', specific: true }
  if (ACTIVITY.test(haystack)) return { kind: 'activity', specific: true }
  return isLink
    ? { kind: 'link', specific: false }
    : { kind: 'text', specific: false }
}
