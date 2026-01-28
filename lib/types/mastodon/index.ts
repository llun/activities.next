// Mastodon API types - Response types for Mastodon-compatible API
// Re-exported from lib/schema/mastodon/ for backward compatibility

// Main exports from schema/mastodon
export * from '@/lib/schema/mastodon/index'

// Additional exports from sub-modules
export { Option as PollOption } from '@/lib/schema/mastodon/poll/option'
export { BaseStatus } from '@/lib/schema/mastodon/status/base'
export { Mention } from '@/lib/schema/mastodon/status/mention'
export { Tag } from '@/lib/schema/mastodon/status/tag'
export { Application } from '@/lib/schema/mastodon/status/application'
