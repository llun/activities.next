import type {
  AdminDomain,
  AdminDomainCheck,
  AdminDomainCheckItem
} from '@/lib/services/domains/adminDomainTypes'

// The words and badge tones Admin › Served domains shows for a domain. Pure, so the
// list page (a server component) and the client forms say the same thing.

/** A domain's page in Admin › Served domains. */
export const domainSettingsHref = (domain: string) =>
  `/admin/domains/${encodeURIComponent(domain)}`

export type DomainBadgeTone = 'gray' | 'success' | 'warning' | 'destructive'

export interface DomainBadge {
  label: string
  tone: DomainBadgeTone
}

/** The list's Status column: whether the domain serves, and whether it reached us. */
export const getDomainStatusBadge = (domain: AdminDomain): DomainBadge => {
  if (domain.source !== 'database') return { label: 'On', tone: 'success' }
  if (domain.lastCheck && !domain.lastCheck.passed) {
    return { label: 'Not reachable', tone: 'destructive' }
  }
  if (domain.status === 'off') return { label: 'Off', tone: 'gray' }
  return { label: 'Reachable', tone: 'success' }
}

/** The domain page's check badge, next to its On/Off badge. */
export const getDomainCheckBadge = (
  domain: AdminDomain
): DomainBadge | null => {
  if (domain.source !== 'database') return null
  if (!domain.lastCheck) return { label: 'Not checked', tone: 'gray' }
  return domain.lastCheck.passed
    ? { label: 'Reachable', tone: 'success' }
    : { label: 'Not reachable', tone: 'destructive' }
}

export const getDomainOnOffBadge = (domain: AdminDomain): DomainBadge =>
  domain.status === 'on'
    ? { label: 'On', tone: 'success' }
    : { label: 'Off', tone: 'gray' }

/** The list's Sign-ups column. */
export const getSignupsBadge = (domain: AdminDomain): DomainBadge => {
  if (!domain.signupsOpen) return { label: 'Closed', tone: 'gray' }
  const count = domain.allowedEmails.length
  if (count === 0) return { label: 'Open', tone: 'success' }
  return {
    label: `Open to ${count} email${count === 1 ? '' : 's'}`,
    tone: 'warning'
  }
}

/** The muted line under an env domain's name in the list. */
export const getDomainSourceNote = (domain: AdminDomain): string | null => {
  switch (domain.source) {
    case 'primary':
      return 'From ACTIVITIES_HOST. The server name and sign-up settings are in Server settings.'
    case 'env':
      return 'From ACTIVITIES_TRUSTED_HOSTS. Remove it from the env to turn it off.'
    case 'database':
      return null
  }
}

export const DOMAIN_CHECK_ITEM_TITLES: Record<
  AdminDomainCheckItem['key'],
  string
> = {
  dns: 'DNS points here',
  tls: 'TLS certificate',
  host: 'Proxy passes the Host header'
}

/** The muted sentence under one item of a check. */
export const getDomainCheckItemDetail = (
  domain: string,
  item: AdminDomainCheckItem,
  reason: AdminDomainCheck['reason']
): string => {
  switch (item.key) {
    case 'dns':
      if (item.status === 'passed')
        return `${domain} resolves to a public address.`
      if (reason === 'private-address') {
        return `${domain} resolves to a private address. Point it at this server’s public address.`
      }
      return `${domain} does not resolve. Add a DNS record that points it at this server.`
    case 'tls':
      if (item.status === 'passed') return `${domain} has a valid certificate.`
      if (item.status === 'failed') {
        return `No valid certificate for ${domain}. Issue one for this domain.`
      }
      if (reason === 'unreachable') {
        return `Nothing answered on https://${domain}. Check the firewall and that the proxy listens for this domain.`
      }
      return 'Checked once DNS points here.'
    case 'host':
      if (item.status === 'passed') return `${domain} answers as this server.`
      if (reason === 'host-header') {
        return 'The request reached this server with another Host. Keep the original Host header when the proxy forwards requests.'
      }
      if (reason === 'other-server') {
        return `${domain} answers, but not as this server. Point the proxy for this domain at this server.`
      }
      return 'Checked once the steps above pass.'
  }
}
