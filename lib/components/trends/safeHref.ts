// Trend posts and news cards link to URLs that originate from remote/federated
// payloads (status `url`/`uri`, preview-card `url`). Restrict those to http(s)
// so an untrusted value can't smuggle a `javascript:` (or other) protocol into
// an anchor's href. Anything else collapses to '#'.
export const safeExternalHref = (url: string | null | undefined): string => {
  if (!url) return '#'
  return /^https?:\/\//i.test(url) ? url : '#'
}
