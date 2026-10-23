import type {
  SavedProfile,
  UpdateProfileInput
} from '@/lib/types/domain/savedProfile'

import { throwApiError } from './http'

/**
 * Saves the signed-in actor's profile with `PATCH /api/v1/accounts/profile`.
 * Send only the keys that changed; the answer is the profile as saved. A
 * rejected value throws an `ApiRequestError` carrying the server's message.
 */
export const updateProfile = async (
  input: UpdateProfileInput
): Promise<SavedProfile> => {
  const response = await fetch('/api/v1/accounts/profile', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(input)
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to save profile')
  }
  return response.json()
}
