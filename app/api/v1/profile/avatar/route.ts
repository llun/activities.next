import {
  PROFILE_IMAGE_CORS_HEADERS,
  deleteProfileImageHandler
} from '@/lib/services/accounts/profileImageHandlers'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const OPTIONS = defaultOptions(PROFILE_IMAGE_CORS_HEADERS)

// DELETE /api/v1/profile/avatar — remove the avatar of the current actor.
// https://docs.joinmastodon.org/methods/profile/#delete-profile-avatar
export const DELETE = traceApiRoute(
  'deleteProfileAvatar',
  deleteProfileImageHandler('iconUrl')
)
