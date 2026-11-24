import { throwApiError } from '@/lib/client/http'
import type {
  BlueskyAccountState,
  BlueskyHandleCheck
} from '@/lib/utils/blueskyAccount'

const send = async <T>(
  path: string,
  method: 'POST' | 'DELETE',
  fallback: string,
  body?: unknown
): Promise<T> => {
  const response = await fetch(`/api/v1/bluesky/account${path}`, {
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

/** Returns the Bluesky authorization URL to open. */
export const startBlueskySignIn = async (handle: string): Promise<string> =>
  (
    await send<{ url: string }>(
      '/oauth',
      'POST',
      'Unable to start Bluesky sign-in.',
      { handle }
    )
  ).url

export const linkBlueskyAppPassword = (
  identifier: string,
  password: string
): Promise<BlueskyAccountState> =>
  send('/app-password', 'POST', 'Unable to link the Bluesky account.', {
    identifier,
    password
  })

export const unlinkBlueskyAccount = (): Promise<BlueskyAccountState> =>
  send('', 'DELETE', 'Unable to unlink the Bluesky account.')

export const checkBlueskyHandle = (): Promise<BlueskyHandleCheck> =>
  send('/handle-check', 'POST', 'Unable to check the handle.')

export const setBlueskyInstanceHandle = (
  enabled: boolean
): Promise<BlueskyAccountState> =>
  send('/instance-handle', 'POST', 'Unable to update the server handle.', {
    enabled
  })
