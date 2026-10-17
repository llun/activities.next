export type ProfileFieldIconKind =
  'location' | 'image' | 'activity' | 'mail' | 'link' | 'text'

export interface ProfileFieldIconChoice {
  kind: ProfileFieldIconKind
  /** Whether the value holds a link. */
  isLink: boolean
}

const LOCATION = /\b(location|based|hometown|city|lives?|living)\b/
const IMAGE =
  /\b(photo|photos|photography|gallery|flickr|pixelfed|instagram|500px)\b/
const ACTIVITY = /\b(strava|fitness|run|running|ride|riding|garmin|activity)\b/
const MAIL = /\b(mail|email|e-mail)\b/

const hrefOf = (value: string) =>
  /<a\s[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(value)

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
// `isLink` says whether the value holds a link, so callers agree on it.
export const chooseProfileFieldIcon = (
  label: string,
  value: string
): ProfileFieldIconChoice => {
  const match = hrefOf(value)
  const href = match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
  const isLink = match !== null
  const labelText = label.toLowerCase()
  const haystack = `${labelText} ${href ? hostOf(href).toLowerCase() : ''}`

  if (LOCATION.test(labelText)) return { kind: 'location', isLink }
  if (MAIL.test(labelText) || href?.toLowerCase().startsWith('mailto:'))
    return { kind: 'mail', isLink }
  if (IMAGE.test(haystack)) return { kind: 'image', isLink }
  if (ACTIVITY.test(haystack)) return { kind: 'activity', isLink }
  return { kind: isLink ? 'link' : 'text', isLink }
}
