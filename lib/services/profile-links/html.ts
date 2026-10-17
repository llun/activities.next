import { Parser } from 'htmlparser2'

import { getProfileFieldHttpsUrl } from '@/lib/utils/text/formatProfileFieldValue'

type TopLevelNode = { tag: string | null; href?: string; text: string }

/**
 * The URL Mastodon's `extract_url_from_html` finds in a remote actor's field
 * value: the whole value must be one `<a>` whose href equals its text content
 * (the markup Mastodon builds for a bare URL, which hides the scheme in a
 * nested span), or a bare URL, and it must be https, as in Mastodon's
 * `Account::Field` (`ACCEPTED_SCHEMES = %w(https)`). Anything else is not
 * verifiable.
 */
export const getLinkFromFieldHtml = (html: string): string | null => {
  const nodes: TopLevelNode[] = []
  let depth = 0
  let current: TopLevelNode | undefined
  const parser = new Parser({
    onopentag(name, attribs) {
      if (depth === 0) {
        current = { tag: name, href: attribs.href, text: '' }
        nodes.push(current)
      }
      depth += 1
    },
    ontext(data) {
      if (depth > 0) {
        if (current) current.text += data
        return
      }
      // The tokenizer splits text around entities; keep one node per run.
      const last = nodes[nodes.length - 1]
      if (last && last.tag === null) last.text += data
      else nodes.push({ tag: null, text: data })
    },
    onclosetag() {
      depth = Math.max(0, depth - 1)
    }
  })
  parser.write(html)
  parser.end()

  const content = nodes.filter((node) => node.tag || node.text.trim())
  if (content.length !== 1) return null
  const [node] = content
  if (node.tag === null) return getProfileFieldHttpsUrl(node.text.trim())
  if (node.tag !== 'a' || !node.href || node.href !== node.text) return null
  return getProfileFieldHttpsUrl(node.href)
}

/**
 * The URL to verify for a stored field value, or null when it is not a single
 * https URL. A local actor's value is the raw text the owner typed; a remote
 * actor's is the HTML its server sent.
 */
export const getVerifiableFieldUrl = (
  value: string,
  { remote }: { remote: boolean }
): string | null =>
  remote ? getLinkFromFieldHtml(value) : getProfileFieldHttpsUrl(value.trim())

/**
 * Whether the page has an `<a>` or `<link>` whose `rel` has the token `me`
 * and whose `href` equals one of `linkBacks` (compared case-insensitively, as
 * Mastodon does). The page is tokenized once, so the cost is linear in its
 * size.
 */
export const hasRelMeLinkTo = (html: string, linkBacks: string[]): boolean => {
  const targets = new Set(linkBacks.map((url) => url.trim().toLowerCase()))
  let found = false
  const parser = new Parser({
    onopentag(name, attribs) {
      if (found || (name !== 'a' && name !== 'link')) return
      const tokens = (attribs.rel ?? '').toLowerCase().split(/\s+/)
      if (!tokens.includes('me')) return
      if (targets.has((attribs.href ?? '').trim().toLowerCase())) found = true
    }
  })
  parser.write(html)
  parser.end()
  return found
}
