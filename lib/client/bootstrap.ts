import type { ClientBootstrapSnapshot } from '@/lib/client/offline/types'
import { isAbortError } from '@/lib/utils/isAbortError'

import { parseApiError } from './http'
import { TimelineRequestError } from './timelines'

export interface GetAccountBootstrapParams {
  signal?: AbortSignal
}

export async function getAccountBootstrap<T = ClientBootstrapSnapshot>(
  params?: GetAccountBootstrapParams
): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api/v1/accounts/bootstrap', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: params?.signal
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    if (error instanceof TimelineRequestError) {
      throw error
    }
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to load account bootstrap'
    throw new TimelineRequestError(message)
  }

  if (!response.ok) {
    const message = await parseApiError(
      response,
      'Failed to load account bootstrap'
    )
    throw new TimelineRequestError(message, response.status)
  }

  return (await response.json()) as T
}
