// The cut point the inbound reply parser looks for.
//
// Mail clients quote the original message *below* the text the sender just
// typed, so a line placed at the very top of our notification email ends up
// directly under their reply once quoted. Everything above it (after the quote
// markers are stripped) is what they actually wrote.
//
// This exact string is the contract with every notification email already
// delivered: changing it silently breaks replies to all of them. If a different
// wording is ever wanted, add the new marker to the set `extractReplyText`
// recognises and keep matching this one.
export const REPLY_SENTINEL = '--- Reply above this line to respond ---'
