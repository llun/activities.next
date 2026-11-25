import { throwApiError } from '@/lib/client/http'
import type {
  HostedBlueskyAccountState,
  HostedBlueskyMoveOutBlobsResult,
  HostedBlueskyMoveOutCancelResult,
  HostedBlueskyMoveOutFinishResult,
  HostedBlueskyMoveOutPreferencesResult,
  HostedBlueskyMoveOutRepoResult,
  HostedBlueskyMoveOutStartResult,
  HostedBlueskyMoveOutState
} from '@/lib/utils/blueskyHosted'

const HOSTED_PATH = '/api/v1/bluesky/hosted'
const MOVE_PATH = '/api/v1/bluesky/hosted/move'

const send = async <T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  fallback: string,
  body?: unknown
): Promise<T> => {
  const response = await fetch(path, {
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
    const response = await fetch(HOSTED_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) return null
    return response.json()
  }

export const createHostedBlueskyAccount = (
  handle: string
): Promise<HostedBlueskyAccountState> =>
  send(HOSTED_PATH, 'POST', 'Unable to create the hosted Bluesky account.', {
    handle
  })

export const updateHostedBlueskyAccount = (input: {
  handle?: string
  recoveryKeyDid?: string | null
  /** Required with `recoveryKeyDid`. */
  currentPassword?: string
  active?: boolean
}): Promise<HostedBlueskyAccountState> =>
  send(
    HOSTED_PATH,
    'PATCH',
    'Unable to update the hosted Bluesky account.',
    input
  )

export const deleteHostedBlueskyAccount = (
  confirmHandle: string
): Promise<HostedBlueskyAccountState> =>
  send(HOSTED_PATH, 'DELETE', 'Unable to delete the hosted Bluesky account.', {
    confirmHandle
  })

/** The stored move's progress and the account state, or null progress. */
export const getHostedBlueskyMoveOut =
  async (): Promise<HostedBlueskyMoveOutState> => {
    const response = await fetch(MOVE_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) await throwApiError(response, 'Unable to load the move.')
    return response.json()
  }

/** Creates the account on the destination server and stores the move. */
export const startHostedBlueskyMoveOut = (input: {
  pdsUrl: string
  handle: string
  email: string
  password: string
  /** The profile's own password, checked before anything is sent. */
  currentPassword: string
  inviteCode?: string
}): Promise<HostedBlueskyMoveOutStartResult> =>
  send(MOVE_PATH, 'POST', 'Unable to start the move.', {
    step: 'start',
    ...input
  })

/** Sends this server's repo to the destination server. */
export const sendHostedBlueskyMoveOutRepo =
  (): Promise<HostedBlueskyMoveOutRepoResult> =>
    send(MOVE_PATH, 'POST', 'Unable to copy your posts.', { step: 'repo' })

/** Copies one batch of missing blobs; pass the returned cursor until `done`. */
export const copyHostedBlueskyMoveOutBlobs = (
  input: { cursor?: string; limit?: number } = {}
): Promise<HostedBlueskyMoveOutBlobsResult> =>
  send(MOVE_PATH, 'POST', 'Unable to copy your media.', {
    step: 'blobs',
    ...input
  })

/** Copies the account's preferences to the destination server. */
export const copyHostedBlueskyMoveOutPreferences =
  (): Promise<HostedBlueskyMoveOutPreferencesResult> =>
    send(MOVE_PATH, 'POST', 'Unable to copy your settings.', {
      step: 'preferences'
    })

/** Switches the account's PLC identity to the destination server. */
export const finishHostedBlueskyMoveOut = (
  currentPassword: string
): Promise<HostedBlueskyMoveOutFinishResult> =>
  send(MOVE_PATH, 'POST', 'Unable to switch to the new server.', {
    step: 'finish',
    currentPassword
  })

/** Cancels a move before the switch, leaving the account here working. */
export const cancelHostedBlueskyMoveOut =
  (): Promise<HostedBlueskyMoveOutCancelResult> =>
    send(MOVE_PATH, 'DELETE', 'Unable to cancel the move.')
