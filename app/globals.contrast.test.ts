import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * WCAG 2.1 AA (SC 1.4.3) guard for muted secondary text.
 *
 * `text-muted-foreground` renders on the muted-family surfaces
 * (`--muted`/`--secondary`/`--accent`, `--card`, `--popover`, `--background`)
 * all over the app. Historically the light-theme token was `hsl(0 0% 45.1%)`
 * (#737373), which only reached ~4.35:1 on the lightest muted surface
 * (`--muted` #f5f5f5) and so failed the 4.5:1 requirement for normal text. This
 * test recomputes the contrast from the live `app/globals.css` token values so
 * the floor can never silently regress in either theme.
 */

// Strip CSS comments up front so declaration parsing can't be tripped up by
// colons/semicolons/`--token`-like text inside a comment (the light
// --muted-foreground now carries a multi-line rationale comment right above it).
const css = readFileSync(
  fileURLToPath(new URL('./globals.css', import.meta.url)),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

const AA_NORMAL = 4.5

type Rgb = [number, number, number]

/** Parse a space-separated `hsl(H S% L%)` string into [h, s(0-1), l(0-1)]. */
const parseHsl = (value: string): [number, number, number] => {
  const match = value.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/)
  if (!match) throw new Error(`Not a space-separated hsl() value: ${value}`)
  return [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100]
}

const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x]
  const m = l - c / 2
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ]
}

const relativeLuminance = ([r, g, b]: Rgb): number => {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

const contrastRatio = (a: Rgb, b: Rgb): number => {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Escape every regex metacharacter (including backslash) in a literal. */
const escapeRegExp = (literal: string): string =>
  literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Extract the flat `--token: value;` declarations of a top-level CSS block. */
const parseBlock = (selector: string): Record<string, string> => {
  const escaped = escapeRegExp(selector)
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`Could not find CSS block for ${selector}`)
  const tokens: Record<string, string> = {}
  for (const line of match[1].split(';')) {
    // Anchor to statement start so only real declarations match, never a
    // `--token`-like fragment inside a value.
    const decl = line.match(/^\s*(--[\w-]+)\s*:\s*(.+)/)
    if (decl) tokens[decl[1].trim()] = decl[2].trim()
  }
  return tokens
}

const rgbOf = (tokens: Record<string, string>, name: string): Rgb =>
  hslToRgb(...parseHsl(tokens[name]))

const themes = {
  light: parseBlock(':root'),
  dark: parseBlock('.dark')
} as const

// The muted-family surfaces that muted secondary text actually renders on.
const surfaceTokens = [
  '--background',
  '--card',
  '--popover',
  '--muted',
  '--secondary',
  '--accent'
]

const cases = (['light', 'dark'] as const).flatMap((theme) =>
  surfaceTokens.map((surface) => ({ theme, surface }))
)

describe('muted-foreground contrast (WCAG 2.1 AA SC 1.4.3)', () => {
  it.each(cases)(
    '$theme --muted-foreground on $surface meets 4.5:1',
    ({ theme, surface }) => {
      const tokens = themes[theme]
      const fg = rgbOf(tokens, '--muted-foreground')
      const bg = rgbOf(tokens, surface)
      const ratio = contrastRatio(fg, bg)
      expect(
        ratio,
        `${theme} muted-foreground ${JSON.stringify(fg)} on ${surface} ${JSON.stringify(bg)} = ${ratio.toFixed(3)}:1`
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  )

  it('keeps muted-foreground visibly muted (lighter than the foreground text)', () => {
    // Guard against "fixing" contrast by darkening the token to near-black: the
    // muted color must stay clearly lighter than the primary --foreground.
    const light = themes.light
    const mutedLum = relativeLuminance(rgbOf(light, '--muted-foreground'))
    const foregroundLum = relativeLuminance(rgbOf(light, '--foreground'))
    expect(mutedLum).toBeGreaterThan(foregroundLum + 0.1)
  })
})
