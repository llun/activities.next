// Limits for status emoji reactions, shared by the storage layer, the write API
// and (later) the picker UI.
//
// It lives in its own dependency-free module — like `pollDurations` next door —
// so both server code and Client Components can import the value without either
// side pulling the other's module graph in (see the Server/Client Module
// Boundary section in AGENTS.md).

// How many *distinct* reactions one actor may place on one status. Matches the
// glitch-soc reaction PR's `MAX_REACTIONS` default of 8 and is enforced for both
// local writes and inbound federated reactions.
export const MAX_REACTIONS_PER_ACTOR = 8

// Product cap for a reaction as it arrives on the wire (a unicode grapheme
// cluster or a `:shortcode:`). Mirrors the announcement-reaction route's bound.
export const MAX_REACTION_NAME_LENGTH = 100

// Hard cap for the name actually stored, which for a remote custom emoji is the
// derived `shortcode@domain` and so can be much longer than the raw reaction.
// Matches the `varchar(255)` columns it lands in: `status_reactions.name` and
// `notifications.reactionName`.
export const MAX_STORED_REACTION_NAME_LENGTH = 255

// `notifications.groupKey` is also varchar(255), but it is a *concatenation* of
// a status id (a URL) and the reaction name, so bounding the name alone does not
// bound it. Postgres rejects the oversized write; SQLite ignores varchar lengths
// entirely, so no SQLite-only test can catch a regression here.
export const MAX_NOTIFICATION_GROUP_KEY_LENGTH = 255
