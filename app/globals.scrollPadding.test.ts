import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards for the mobile `scroll-padding-top` blocks in app/globals.css.
 *
 * Below `md` the page chrome is fixed or sticky over the content (the compact
 * bar, or the profile's floating menu button), so the scroll snapport is padded
 * to keep a keyboard focus or an in-page jump from landing under it (WCAG
 * 2.4.11). jsdom paints no CSS and the data attributes the selectors key on are
 * guarded component-side, so the only way this can regress silently is the
 * stylesheet drifting from them: a deleted block, a renamed attribute selector,
 * a shrunk offset, or the media query moved off the `md` breakpoint (below
 * which the chrome is shown). Same text-scan-of-comment-stripped-CSS approach
 * as app/globals.skeleton.test.ts.
 */

const css = readFileSync(
  fileURLToPath(new URL('./globals.css', import.meta.url)),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the first `{ … }` block opened by `prelude`, braces balanced. */
const bodyOf = (source: string, prelude: RegExp): string => {
  const match = prelude.exec(source)
  if (!match) throw new Error(`Could not find ${prelude}`)
  const start = match.index + match[0].length
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    if (depth === 0) return source.slice(start, i)
  }
  throw new Error(`Unbalanced braces after ${prelude}`)
}

// Tailwind's `md` breakpoint is 48rem; the chrome is `md:hidden`, so the
// padding must stop at exactly the width the chrome does.
const mobileQuery = bodyOf(css, /@media\s*\(width\s*<\s*48rem\)\s*\{/)

// Returns the rem term of `calc(env(safe-area-inset-top, 0px) + <n>rem)`, with
// the connection strip's height (`var(--status-strip-h, 0px)`) allowed after
// it; the pattern requires the safe-area term, so a block without it throws.
const offsetOf = (selector: string): number => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = bodyOf(mobileQuery, new RegExp(`${escaped}\\s*\\{`))
  const match = body.match(
    /scroll-padding-top\s*:\s*calc\(\s*env\(safe-area-inset-top,\s*0px\)\s*\+\s*([\d.]+)rem\s*(?:\+\s*var\(--status-strip-h,\s*0px\)\s*)?\)\s*;/
  )
  if (!match) throw new Error(`No safe-area scroll-padding-top in ${selector}`)
  return Number(match[1])
}

describe('mobile scroll-padding for fixed chrome', () => {
  it('clears the 56px compact bar and its border plus the safe area', () => {
    const rem = offsetOf('html:has([data-mobile-compact-header])')
    // 56px bar (55px + 1px border) is 3.5rem; the offset keeps a gap below it.
    expect(rem).toBeGreaterThanOrEqual(3.5)
  })

  it('clears the compact bar and the Edit profile phone bar together', () => {
    const body = bodyOf(
      mobileQuery,
      /html:has\(\[data-mobile-compact-header\]\):has\(\s*\[data-slot='profile-editor-phone-bar'\]\s*\)\s*\{/
    )
    const match = body.match(
      /calc\(\s*env\(safe-area-inset-top,\s*0px\)\s*\+\s*([\d.]+)rem\s*\+\s*var\(--status-strip-h,\s*0px\)\s*\)/
    )
    expect(match).not.toBeNull()
    // 56px compact bar + 53px profile bar is 6.8rem; keep a gap below it.
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(6.8)
  })

  it('clears the 44px floating menu button at its 16px inset plus the safe area', () => {
    const rem = offsetOf('html:has([data-floating-nav-trigger])')
    // 16px inset + 44px button is 3.75rem; the offset keeps a gap below it.
    expect(rem).toBeGreaterThanOrEqual(3.75)
  })

  it('offsets the new-posts pill below the strip through its data attribute, not a utility class', () => {
    // `.top-full` is a Tailwind utility on that element: a selector coupled to
    // it breaks silently when the markup's classes change.
    expect(css).toMatch(
      /html:has\(\[data-connection-strip\]\)\s+\[data-compact-header-overlay\]\s*\{[^}]*top\s*:\s*calc\(\s*100%\s*\+\s*var\(--status-strip-h/
    )
    expect(css).not.toMatch(/\[data-mobile-compact-header\]\s*>\s*\.top-full/)
  })

  it('applies both blocks only below the md breakpoint', () => {
    // Outside the media query the same selectors must not pad the page: the
    // chrome is `md:hidden`, so a desktop offset would be dead space.
    // Every below-md block goes, not only the first: the strip's pill offset
    // lives in a second one.
    let outside = css
    for (;;) {
      const match = /@media\s*\(width\s*<\s*48rem\)\s*\{/.exec(outside)
      if (!match) break
      const body = bodyOf(outside, /@media\s*\(width\s*<\s*48rem\)\s*\{/)
      outside =
        outside.slice(0, match.index) +
        outside.slice(match.index + match[0].length + body.length + 1)
    }
    expect(outside).not.toContain('data-mobile-compact-header')
    expect(outside).not.toContain('data-floating-nav-trigger')
  })
})
