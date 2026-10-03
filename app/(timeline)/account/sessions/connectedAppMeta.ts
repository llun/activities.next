import { formatDistance } from 'date-fns/formatDistance'

// The connected-app meta line reads "tapbots.com/ivory · Authorized 12 days
// ago": the website without its scheme (the path stays, a trailing slash does
// not) and a relative time, as drawn in the design system.
export const formatAppWebsite = (website: string): string =>
  website
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')

export const formatConnectedAppMeta = ({
  website,
  signIn,
  authorizedAt,
  currentTime
}: {
  website: string | null
  signIn: boolean
  authorizedAt: number
  currentTime: number
}): string => {
  const host = website ? formatAppWebsite(website) : ''
  const action = signIn ? 'Signs you in' : 'Authorized'
  const when = formatDistance(authorizedAt, currentTime, { addSuffix: true })
  return `${host ? `${host} · ` : ''}${action} ${when}`
}
