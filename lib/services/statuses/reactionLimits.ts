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

// Storage cap for a reaction name (unicode grapheme cluster, a local shortcode,
// or `shortcode@domain`). Mirrors the announcement-reaction route's bound and
// the `varchar(255)` column it is stored in.
export const MAX_REACTION_NAME_LENGTH = 100
