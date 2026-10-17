export type ProfileFieldIconKind =
  'location' | 'image' | 'activity' | 'mail' | 'link' | 'text'

export interface ProfileFieldIconChoice {
  kind: ProfileFieldIconKind
  /** Whether the value holds a link. */
  isLink: boolean
}

// Label keywords are word-bounded; link hosts are matched against explicit
// domain lists (the host itself or a subdomain), never by keyword.
const LOCATION = /\b(location|based|hometown|city|lives?|living)\b/
const IMAGE = /\b(photo|photos|photography|gallery|flickr|pixelfed|instagram)\b/
const ACTIVITY = /\b(strava|fitness|run|running|ride|riding|garmin|activity)\b/
const MAIL = /\b(mail|email|e-mail)\b/

const IMAGE_DOMAINS = ['flickr.com', 'instagram.com', '500px.com']
const ACTIVITY_DOMAINS = ['strava.com', 'garmin.com', 'runkeeper.com']

const inDomains = (host: string, domains: string[]) =>
  domains.some((domain) => host === domain || host.endsWith(`.${domain}`))

// `pixelfed.social`, `pixelfed.org`: a `pixelfed` label before the TLD.
const isPixelfedHost = (host: string) =>
  host.split('.').slice(0, -1).includes('pixelfed')

// Linear on its input: first the opening tag, then the attribute inside it.
const hrefOf = (value: string) => {
  const tag = /<a\s[^>]*>/i.exec(value)?.[0]
  if (!tag) return null
  const match = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}

const hostOf = (href: string) => {
  try {
    return new URL(href).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// Picks the icon of a profile field: a keyword match on the label, then the
// link's host. `value` is the field's sanitized HTML, so `isLink` is what is
// actually rendered. `isLink` also tells callers whether the value is a link.
export const chooseProfileFieldIcon = (
  label: string,
  value: string
): ProfileFieldIconChoice => {
  const href = hrefOf(value)
  const isLink = href !== null
  const labelText = label.toLowerCase()
  const host = href ? hostOf(href) : ''

  if (LOCATION.test(labelText)) return { kind: 'location', isLink }
  if (MAIL.test(labelText) || href?.toLowerCase().startsWith('mailto:'))
    return { kind: 'mail', isLink }
  if (
    IMAGE.test(labelText) ||
    inDomains(host, IMAGE_DOMAINS) ||
    isPixelfedHost(host)
  )
    return { kind: 'image', isLink }
  if (ACTIVITY.test(labelText) || inDomains(host, ACTIVITY_DOMAINS))
    return { kind: 'activity', isLink }
  return { kind: isLink ? 'link' : 'text', isLink }
}
