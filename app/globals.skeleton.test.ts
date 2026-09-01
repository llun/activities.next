import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards for the `skeleton` loading utility in app/globals.css.
 *
 * The class is applied by the `(timeline)/[actor]` loading skeletons, but
 * jsdom renders no CSS, so no component test can notice the definition
 * disappearing — exactly how `no-scrollbar` was once applied for a long time
 * while being defined nowhere and silently did nothing. These assertions read
 * the live stylesheet: the utility must exist, its tokens must be declared in
 * BOTH themes (a token defined only for light silently loses dark), the base
 * tone must stay visibly distinct from the surfaces it loads over (the bug the
 * utility replaced: `animate-pulse bg-muted` at 96.1% lightness on the white
 * background left the whole animation within ~2 points of lightness), the
 * composited highlight band must stay visibly distinct from the base in each
 * theme (a highlight whose blended lightness matches the base renders the
 * shimmer invisible while every other assertion stays green), and the shimmer
 * must be stilled under prefers-reduced-motion.
 */

// Strip comments first so token parsing cannot match `--token`-like text
// inside a rationale comment (same treatment as app/globals.contrast.test.ts).
const css = readFileSync(
  fileURLToPath(new URL('./globals.css', import.meta.url)),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

/** Extract the body of the first top-level CSS block for a selector. */
const blockOf = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`Could not find CSS block for ${selector}`)
  return match[1]
}

const tokenOf = (block: string, name: string): string => {
  const match = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  if (!match) throw new Error(`No ${name} declaration in block`)
  return match[1].trim()
}

/** Lightness (0-100) and alpha (0-1) of a space-separated `hsl(H S% L% [/ A])` value. */
const lightnessAndAlphaOf = (
  value: string
): { lightness: number; alpha: number } => {
  const match = value.match(
    /hsl\(\s*[\d.]+\s+[\d.]+%\s+([\d.]+)%(?:\s*\/\s*([\d.]+))?\s*\)/
  )
  if (!match) throw new Error(`Not a space-separated hsl() value: ${value}`)
  return {
    lightness: Number(match[1]),
    alpha: match[2] === undefined ? 1 : Number(match[2])
  }
}

const lightnessOf = (value: string): number =>
  lightnessAndAlphaOf(value).lightness

describe('skeleton loading utility', () => {
  it('defines the .skeleton class the loading skeletons apply', () => {
    expect(css).toMatch(/\.skeleton\s*\{/)
    expect(css).toMatch(/\.skeleton::after\s*\{/)
    expect(css).toMatch(/@keyframes skeleton-shimmer/)
  })

  it.each([':root', '.dark'])('declares the skeleton tokens in %s', (theme) => {
    const block = blockOf(theme)
    expect(tokenOf(block, '--skeleton')).toBeTruthy()
    expect(tokenOf(block, '--skeleton-highlight')).toBeTruthy()
  })

  it('keeps the light skeleton visibly darker than the background', () => {
    const root = blockOf(':root')
    const skeleton = lightnessOf(tokenOf(root, '--skeleton'))
    const background = lightnessOf(tokenOf(root, '--background'))
    expect(skeleton).toBeLessThanOrEqual(background - 8)
  })

  it('keeps the dark skeleton visibly lighter than the card', () => {
    const dark = blockOf('.dark')
    const skeleton = lightnessOf(tokenOf(dark, '--skeleton'))
    const card = lightnessOf(tokenOf(dark, '--card'))
    expect(skeleton).toBeGreaterThanOrEqual(card + 8)
  })

  it.each([':root', '.dark'])(
    'keeps the %s shimmer band visible against the base',
    (theme) => {
      // The highlight IS the shimmer: a band whose composited lightness matches
      // the base renders the sweep invisible while every other assertion stays
      // green. Lightness-space compositing is exact for these grey (0% sat)
      // tokens, and the parser throws loudly on any other value form.
      const block = blockOf(theme)
      const base = lightnessAndAlphaOf(tokenOf(block, '--skeleton'))
      const highlight = lightnessAndAlphaOf(
        tokenOf(block, '--skeleton-highlight')
      )
      const effective =
        highlight.alpha * highlight.lightness +
        (1 - highlight.alpha) * base.lightness
      expect(Math.abs(effective - base.lightness)).toBeGreaterThanOrEqual(5)
    }
  )

  it('stills the shimmer under prefers-reduced-motion', () => {
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.skeleton::after\s*\{[^}]*display:\s*none/
    )
  })
})
