import { ResolvedServerSettings } from '@/lib/config/serverSettings'

export interface StatusContentToValidate {
  status?: string
  // expires_in is optional on edit (omitted keeps the current expiry), so the
  // expiry range is only checked when a value is provided.
  poll?: { options: string[]; expires_in?: number } | null
}

// Enforces the admin-configured status/poll limits (server settings) after the
// request schema has validated structure. Returns a Mastodon-style error
// message when the text or poll exceeds a resolved limit, or null when within
// limits. Shared by the create and edit routes so the two cannot drift.
export const validateStatusContentLimits = (
  content: StatusContentToValidate,
  settings: ResolvedServerSettings
): string | null => {
  const text = content.status ?? ''
  if (text.length > settings.posts.maxCharacters) {
    return `Text character limit of ${settings.posts.maxCharacters} exceeded`
  }

  const poll = content.poll
  if (poll) {
    const { polls } = settings
    if (poll.options.length > polls.maxOptions) {
      return `Poll cannot have more than ${polls.maxOptions} options`
    }
    if (
      poll.options.some(
        (option) => option.length > polls.maxCharactersPerOption
      )
    ) {
      return `Poll option character limit of ${polls.maxCharactersPerOption} exceeded`
    }
    if (
      poll.expires_in !== undefined &&
      (poll.expires_in < polls.minExpirationSeconds ||
        poll.expires_in > polls.maxExpirationSeconds)
    ) {
      return 'Poll expiration is out of range'
    }
  }

  return null
}
