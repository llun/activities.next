// A passkey as returned by `GET /api/v1/passkeys`, including the domain it was
// registered on (a WebAuthn credential is bound to one domain).
export interface Passkey {
  id: string
  name: string | null
  domain: string
  deviceType: string
  backedUp: boolean
  createdAt: string
  aaguid: string | null
}

/**
 * Lists the signed-in account's passkeys with the domain each is bound to.
 * @see app/api/v1/passkeys/route.ts
 */
export const getPasskeys = async (): Promise<Passkey[]> => {
  const response = await fetch('/api/v1/passkeys', {
    method: 'GET',
    credentials: 'include'
  })
  if (!response.ok) {
    throw new Error('Failed to load passkeys')
  }
  const data = await response.json()
  return Array.isArray(data) ? data : []
}
