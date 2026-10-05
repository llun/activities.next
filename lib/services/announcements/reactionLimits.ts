// How many *distinct* reaction names one announcement may carry, across all
// reactors. Matches Mastodon's `AnnouncementReaction::LIMIT`. Every signed-in
// user's home banner reads the rollup of every active announcement, so the
// number of groups it can hold has to be bounded by the announcement, not by
// how many names its readers care to invent.
export const MAX_ANNOUNCEMENT_REACTION_NAMES = 8
