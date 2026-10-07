// Mastodon's `acct` is RELATIVE to the domain the client connected through: a
// bare username means "this account is on the instance you're talking to", while
// `username@domain` means "on some other host". This instance answers on
// multiple domains, so the same actor must render bare to a client on its own
// domain and qualified to a client on another.
//
// The decision needs two facts: the actor's own domain and the access domain.
// The actor's domain is already carried by the account we built — the domain
// of a qualified `acct`, which is the stored handle and need not be the host of
// the actor id (a remote actor whose host redirected WebFinger to another
// handle domain), or else the host of its `url`, the canonical actor id (e.g.
// `https://llun.dev/users/null`) — and the access domain only exists in the
// request. So this is a pure PRESENTATION transform of
// (already-built account, access domain) — the database layer never needs the
// per-request host. Callers apply it at the route boundary where the access
// domain (from headerHost) is available.

type LocalizableAccount = { username: string; acct: string; url: string }

const toBareHost = (host: string) =>
  host.includes('://') ? new URL(host).host : host

const getAccountDomain = ({ acct, url }: LocalizableAccount) => {
  const urlHost = new URL(url).host
  // Callers outside the typed path (partial account objects) may carry no
  // `acct`; the url's host is then the only domain there is.
  const acctDomain = typeof acct === 'string' ? acct.split('@')[1] : undefined
  return acctDomain || urlHost
}

/**
 * Re-render `acct` relative to `accessDomain`: bare when the account's own
 * domain (its qualified `acct`'s, else its canonical `url`'s) matches the
 * host the client connected through, `username@domain` otherwise. Returns the account unchanged when no
 * access domain is given (non-request/federation callers) or when `url` is not
 * a parseable absolute URL. Never alters identity (`id`/`url`/keys) — only the
 * display `acct`.
 */
export const localizeAccount = <T extends LocalizableAccount>(
  account: T,
  accessDomain: string | undefined
): T => {
  if (!accessDomain) return account
  let actorDomain: string
  try {
    actorDomain = getAccountDomain(account)
  } catch {
    return account
  }
  const isLocal =
    actorDomain.toLowerCase() === toBareHost(accessDomain).toLowerCase()
  const acct = isLocal
    ? account.username
    : `${account.username}@${actorDomain.toLowerCase()}`
  return acct === account.acct ? account : { ...account, acct }
}

export const localizeAccounts = <T extends LocalizableAccount>(
  accounts: T[],
  accessDomain: string | undefined
): T[] => accounts.map((account) => localizeAccount(account, accessDomain))
