import type {
  AdminDomain,
  AdminDomainList
} from '@/lib/services/domains/adminDomainTypes'

// Admin › Domains. Every call throws an Error carrying the server's message,
// which the forms show as is.

export class AdminDomainRequestError extends Error {
  readonly code: string | null
  // The domain as it stands after a failed "Turn on" (with the new check).
  readonly domain: AdminDomain | null

  constructor(
    message: string,
    code: string | null,
    domain: AdminDomain | null
  ) {
    super(message)
    this.name = 'AdminDomainRequestError'
    this.code = code
    this.domain = domain
  }
}

const domainPath = (domain: string) =>
  `/api/v1/admin/domains/${encodeURIComponent(domain)}`

const readResponse = async <T>(
  response: Response,
  fallback: string
): Promise<T> => {
  if (response.ok) return (await response.json()) as T
  const body = (await response.json().catch(() => null)) as {
    error?: unknown
    code?: unknown
    domain?: unknown
  } | null
  throw new AdminDomainRequestError(
    typeof body?.error === 'string' ? body.error : fallback,
    typeof body?.code === 'string' ? body.code : null,
    body?.domain && typeof body.domain === 'object'
      ? (body.domain as AdminDomain)
      : null
  )
}

const send = (url: string, method: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : null)
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : null)
  })

export const getAdminDomains = async (): Promise<AdminDomainList> =>
  readResponse(
    await send('/api/v1/admin/domains', 'GET'),
    'Failed to load domains'
  )

// Adds a domain, runs the check and saves it as off. The returned domain
// carries the check result.
export const addAdminDomain = async (domain: string): Promise<AdminDomain> =>
  readResponse(
    await send('/api/v1/admin/domains', 'POST', { domain }),
    'Failed to add the domain. Please try again.'
  )

export const checkAdminDomain = async (domain: string): Promise<AdminDomain> =>
  readResponse(
    await send(`${domainPath(domain)}/check`, 'POST'),
    'Failed to check the domain. Please try again.'
  )

export const setAdminDomainStatus = async (
  domain: string,
  status: 'on' | 'off'
): Promise<AdminDomain> =>
  readResponse(
    await send(domainPath(domain), 'PATCH', { status }),
    status === 'on'
      ? 'Failed to turn the domain on. Please try again.'
      : 'Failed to turn the domain off. Please try again.'
  )

export interface AdminDomainRegistrations {
  signupsOpen?: boolean
  allowedEmails?: string[]
  allowExistingUsers?: boolean
}

export const updateAdminDomainRegistrations = async (
  domain: string,
  registrations: AdminDomainRegistrations
): Promise<AdminDomain> =>
  readResponse(
    await send(domainPath(domain), 'PATCH', registrations),
    'Failed to save changes. Please try again.'
  )

export const removeAdminDomain = async (domain: string): Promise<void> => {
  await readResponse<unknown>(
    await send(domainPath(domain), 'DELETE'),
    'Failed to remove the domain. Please try again.'
  )
}
