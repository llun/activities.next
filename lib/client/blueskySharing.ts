import { throwApiError } from '@/lib/client/http'
import type { BlueskySharingState } from '@/lib/utils/blueskySharing'

export const updateBlueskySharing = async (
  enabled: boolean
): Promise<BlueskySharingState> => {
  const response = await fetch('/api/v1/accounts/bluesky-sharing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  })
  if (!response.ok)
    await throwApiError(response, 'Unable to update Bluesky sharing.')
  return response.json()
}
