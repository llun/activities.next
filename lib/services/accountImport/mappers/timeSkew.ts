// The clock skew an archived timestamp may run ahead of the importing
// server's now. parsePublished bounds a status's published time with it, the
// edit mapper bounds every archived supersede time with it, and
// appendStatusHistory re-checks it as a defensive last stop before the value
// reaches statuses.updatedAt (the API's edited_at).
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000
