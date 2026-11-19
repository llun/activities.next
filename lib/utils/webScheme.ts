// No imports: lib/utils/host.ts uses this, and proxy.ts (Edge runtime) imports
// host.ts, so nothing Node-only may come with it.

const isWebUrl = (value: string) => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * The value to hand `new URL` for a domain-ish input: the input itself when the
 * parser already reads it as a web URL or it carries an explicit `scheme://`,
 * otherwise the input behind `https://`.
 *
 * A `://` test alone is not enough. `https:/blocked.example/x`,
 * `https:\\blocked.example/x` and a tab inside the scheme all fetch from
 * blocked.example and `new URL` reads them that way, while a `://` test reads
 * the host as `https` — so a block or an exemption written that way would name
 * a different host than the fetcher contacts.
 */
export const withWebScheme = (value: string): string =>
  isWebUrl(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`
