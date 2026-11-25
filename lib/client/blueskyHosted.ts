import { throwApiError } from '@/lib/client/http'
import type { HostedBlueskyAccountState } from '@/lib/utils/blueskyHosted'

const send = async <T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  fallback: string,
  body?: unknown
): Promise<T> => {
  const response = await fetch('/api/v1/bluesky/hosted', {
    method,
    ...(body !== undefined
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      : {})
  })
  if (!response.ok) await throwApiError(response, fallback)
  return response.json()
}

/** Returns the viewer's hosted Bluesky account state, or null on failure. */
export const getHostedBlueskyAccount =
  async (): Promise<HostedBlueskyAccountState | null> => {
    const response = await fetch('/api/v1/bluesky/hosted', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) return null
    return response.json()
  }

export const createHostedBlueskyAccount = (
  handle: string
): Promise<HostedBlueskyAccountState> =>
  send('POST', 'Unable to create the hosted Bluesky account.', { handle })

export const updateHostedBlueskyAccount = (input: {
  handle?: string
  recoveryKeyDid?: string | null
  active?: boolean
}): Promise<HostedBlueskyAccountState> =>
  send('PATCH', 'Unable to update the hosted Bluesky account.', input)

export const deleteHostedBlueskyAccount = (
  confirmHandle: string
): Promise<HostedBlueskyAccountState> =>
  send('DELETE', 'Unable to delete the hosted Bluesky account.', {
    confirmHandle
  })
