import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `app/globals.contrast.test.ts` guards the CSS custom-property tokens. It
 * cannot see a literal Tailwind palette class, so a callout written as
 * `text-yellow-600` on `bg-yellow-50` passed lint, build and the whole suite
 * at 2.83:1 — under the 4.5:1 floor, on the one paragraph whose entire job is
 * to be read.
 *
 * These are the palette values Tailwind v4 ships (`node_modules/tailwindcss/
 * theme.css`), converted here rather than imported so the check does not
 * depend on the build pipeline.
 */
const OKLCH: Record<string, [number, number, number]> = {
  'yellow-50': [0.987, 0.026, 102.212],
  'yellow-100': [0.973, 0.071, 103.193],
  'yellow-200': [0.945, 0.129, 101.54],
  'yellow-400': [0.852, 0.199, 91.936],
  'yellow-600': [0.681, 0.162, 75.834],
  'yellow-700': [0.554, 0.135, 66.442],
  'yellow-800': [0.476, 0.114, 61.907],
  'yellow-900': [0.421, 0.095, 57.708],
  'yellow-950': [0.286, 0.066, 53.813]
}

const gammaEncode = (value: number) =>
  value > 0.0031308 ? 1.055 * Math.pow(value, 1 / 2.4) - 0.055 : 12.92 * value

const oklchToSrgb = ([lightness, chroma, hue]: [number, number, number]) => {
  const hueRadians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(hueRadians)
  const b = chroma * Math.sin(hueRadians)

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
    .map(gammaEncode)
    .map((channel) => Math.min(1, Math.max(0, channel)))
}

const relativeLuminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4)
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrastRatio = (foreground: string, background: string) => {
  const [lighter, darker] = [
    relativeLuminance(oklchToSrgb(OKLCH[foreground])),
    relativeLuminance(oklchToSrgb(OKLCH[background]))
  ].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

// Callouts used to be written with literal palette classes, and this file held
// an explicit table of them (a regression test over named files, not a scanner:
// a new low-contrast pairing somewhere else was caught by nothing). The Strava
// and Wahoo connection banners that were in it are now `Alert`s on the
// `--warning-text` / `--success-text` / `--info-text` tokens, whose AA contrast
// `app/globals.contrast.test.ts` recomputes in both themes, and
// `surfaceKitUsage.test.ts` stops new palette classes being added. Add a row
// back here only for a callout that genuinely has to use a literal palette.

// WCAG 2.1 SC 1.4.3 for normal-size text. These paragraphs are `text-sm`
// (14px), so the 3:1 large-text exemption does not apply.
const MINIMUM_CONTRAST = 4.5

describe('palette callout contrast', () => {
  // The pairing this replaced shipped at 2.83:1 (yellow-600 on yellow-50),
  // copied from a sibling block that was already failing.
  it('keeps the Strava connection warnings on the warning Alert, not a yellow palette callout', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'app/(timeline)/fitness/connections/strava/StravaSettingsForm.tsx'
      ),
      'utf-8'
    )
    expect(source).toContain('tone="warning"')
    expect(source).not.toMatch(/\b(?:bg|text|border)-yellow-\d/)
  })

  // Guards the converter itself: without this, a bug that returned a constant
  // luminance would make every assertion that uses it pass.
  it('rejects the pairing that shipped at 2.83:1', () => {
    expect(contrastRatio('yellow-600', 'yellow-50')).toBeLessThan(
      MINIMUM_CONTRAST
    )
  })

  it('accepts the pairing that replaced it', () => {
    expect(contrastRatio('yellow-800', 'yellow-50')).toBeGreaterThanOrEqual(
      MINIMUM_CONTRAST
    )
  })
})
