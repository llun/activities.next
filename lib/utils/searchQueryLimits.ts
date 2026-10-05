// A search query is user-typed text, so these bounds only reject abuse. The
// token caps matter most: every token becomes a term in the FTS MATCH /
// to_tsquery / LIKE expression, so an uncapped query is a database cost lever.
export const MAX_SEARCH_QUERY_LENGTH = 1024
export const MAX_SEARCH_QUERY_TOKENS = 12
export const MAX_SEARCH_TOKEN_LENGTH = 64
