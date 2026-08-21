/**
 * @vitest-environment jsdom
 */
import { extractPreviewUrl } from '@/lib/services/link-previews/extractUrl'
import { processStatusTextContent } from '@/lib/utils/text/processStatusText'

/**
 * The extractor and the reader parse the SAME string with DIFFERENT parsers.
 *
 * `extractPreviewUrl` only ever runs server-side (server actions and jobs), so
 * its `htmlToDOM` resolves to `html-dom-parser`'s Node build — htmlparser2,
 * which does no HTML5 tree construction. The reader's `cleanClassName` runs in
 * the browser bundle, where it resolves to `template.innerHTML` and gets the
 * real algorithm. Any HTML5 rule that MOVES content between elements is
 * therefore a place the two can disagree about which anchor owns which text,
 * and one such disagreement is a phishing card: the extractor picks a link that
 * renders as nothing.
 *
 * Nested anchors were the one that mattered — the adoption agency algorithm is
 * unusual in that it EMPTIES an element and re-parents its content — and
 * `getVisibleText` stops at a descendant anchor because of it. This file exists
 * so the next such rule is caught by the suite rather than by an attacker: it
 * checks the extractor's answer against a spec-compliant DOM rather than
 * against hand-written expectations.
 *
 * jsdom is the oracle. It implements HTML5 tree construction, and unlike
 * `parse5` (which reaches us only as jsdom's own transitive dependency) it is a
 * declared devDependency, so this cannot break on an unrelated bump.
 */
const HOST = 'llun.test'

// Anchors this feature deliberately skips for reasons that have nothing to do
// with parsing: social-graph links are not content.
const isNonContentAnchor = (anchor: HTMLAnchorElement): boolean => {
  const rel = (anchor.getAttribute('rel') ?? '').toLowerCase().split(/\s+/)
  if (rel.includes('tag')) return true
  const classes = (anchor.getAttribute('class') ?? '')
    .toLowerCase()
    .split(/\s+/)
  return ['mention', 'hashtag', 'u-url'].some((m) => classes.includes(m))
}

// What the reader can actually read inside `node`: `cleanClassName` maps
// Mastodon's `invisible` onto Tailwind's `hidden` (`display: none`), and a
// nested anchor is not this anchor's text because the two cannot coexist.
const visibleText = (node: Node, belowAnchor = false): string => {
  if (node.nodeType === node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== node.ELEMENT_NODE) return ''
  const element = node as Element
  const classes = (element.getAttribute('class') ?? '')
    .toLowerCase()
    .split(/\s+/)
  if (classes.includes('invisible') || classes.includes('hidden')) return ''
  if (belowAnchor && element.tagName === 'A') return ''
  return Array.from(element.childNodes)
    .map((child) => visibleText(child, true))
    .join('')
}

/**
 * Every href the reader can both see and click, in reading order.
 *
 * `innerHTML` is the POINT here, not an oversight: invoking jsdom's HTML5 tree
 * construction is the whole reason this file exists, and it is exactly what the
 * browser does with this same string at render time (`cleanClassName` resolves
 * to `template.innerHTML` in the client bundle). Parsing it any other way would
 * measure something the reader never sees. Nothing untrusted reaches it — the
 * inputs are the fixtures below — and it runs only under Vitest.
 */
const readerVisibleHrefs = (html: string): string[] => {
  const host = document.createElement('div')
  host.innerHTML = html
  return Array.from(host.querySelectorAll('a'))
    .filter((anchor) => {
      if (!anchor.getAttribute('href')) return false
      if (isNonContentAnchor(anchor)) return false
      // An ancestor that is hidden hides this anchor too.
      for (let el: Element | null = anchor; el; el = el.parentElement) {
        const c = (el.getAttribute('class') ?? '').toLowerCase().split(/\s+/)
        if (c.includes('invisible') || c.includes('hidden')) return false
      }
      return visibleText(anchor).replace(/\s+/g, '') !== ''
    })
    .map((anchor) => anchor.getAttribute('href') as string)
}

const CASES: { description: string; text: string }[] = [
  {
    description: 'a nested anchor',
    text: '<p>New post: <a href="https://evil.example/login"><b><a href="https://good.example/a">good.example/a</a></b></a></p>'
  },
  {
    description: 'a nested anchor around a mention',
    text: '<p>Hey <a href="https://evil.example/login"><b><span class="h-card"><a href="https://good.social/@alice" class="u-url mention">@alice</a></span></b></a> look</p>'
  },
  {
    description: 'an outer anchor with text of its own',
    text: '<p><a href="https://first.example/a">click <b><a href="https://second.example/b">x</a></b></a></p>'
  },
  {
    description: 'a paragraph inside a paragraph',
    text: '<p>a <a href="https://first.example/a">x</a><p>b <a href="https://second.example/b">y</a></p></p>'
  },
  {
    description: 'list items outside a list',
    text: '<li><a href="https://first.example/a">x</a><li><a href="https://second.example/b">y</a>'
  },
  {
    description: 'an unclosed anchor across a block',
    text: '<p><a href="https://first.example/a">x<p><a href="https://second.example/b">y</a></p>'
  },
  {
    description: 'a block element inside an inline one',
    text: '<p><b><p><a href="https://first.example/a">x</a></p></b></p>'
  },
  {
    description: 'a stray close tag',
    text: '<p></b><a href="https://first.example/a">x</a></p>'
  },
  {
    description: 'a blockquote inside a paragraph',
    text: '<p>a<blockquote><a href="https://first.example/a">x</a></blockquote></p>'
  },
  {
    description: 'nested lists',
    text: '<ul><li><a href="https://first.example/a">x</a><ul><li><a href="https://second.example/b">y</a></li></ul></li></ul>'
  },
  {
    description: 'an anchor inside pre',
    text: '<pre><a href="https://first.example/a">x</a></pre>'
  },
  {
    description: 'a hidden ancestor',
    text: '<p><span class="invisible"><a href="https://evil.example/x">x</a></span> <a href="https://good.example/y">y</a></p>'
  },
  {
    description: 'a Mastodon split link',
    text: '<p><a href="https://first.example/very/long"><span class="invisible">https://</span><span class="ellipsis">first.example/very</span><span class="invisible">/long</span></a></p>'
  }
]

describe('the extractor agrees with a spec-compliant parser', () => {
  it.each(CASES)(
    'picks a link the reader can see, given $description',
    ({ text }) => {
      const extracted = extractPreviewUrl({
        text,
        isLocalActor: false,
        host: HOST,
        tags: []
      })
      const visible = readerVisibleHrefs(
        processStatusTextContent(HOST, text, [], false)
      )

      // The contract is not "the extractor equals the first visible link" —
      // normalization and the exclusion rules can legitimately differ. It is the
      // one that matters: whatever it picked, the reader can see it.
      if (extracted === null) return
      expect(visible).toContain(extracted)
    }
  )

  // The above passes vacuously if extraction returns null everywhere, so pin
  // that these inputs really do produce cards.
  it('produces a card for most of these inputs', () => {
    const extracted = CASES.map(({ text }) =>
      extractPreviewUrl({ text, isLocalActor: false, host: HOST, tags: [] })
    )

    expect(extracted.filter(Boolean).length).toBeGreaterThanOrEqual(
      CASES.length - 2
    )
  })
})
