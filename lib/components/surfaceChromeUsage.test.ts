import fs from 'fs'
import path from 'path'

// The translucent bars that sit over the page — the sticky page header, the
// sidebar and icon rail, the mobile header, and the sticky bars of the public
// shell, shared heatmap and status page — all use the design's Surface Chrome
// (white at 72 % in light, #141414 at 80 % in dark) through the
// `bg-surface-chrome` utility. A bar hand-rolled as `bg-background/85` or `/90`
// is the pre-token look: in dark it is the near-black page colour rather than
// the lifted chrome grey, so it reads as a different bar from its neighbours.
//
// Each row is a file and the number of bars in it that must carry the token.
const CHROME_BARS: Array<[file: string, bars: number]> = [
  ['lib/components/page-header.tsx', 1],
  ['lib/components/layout/sidebar.tsx', 2],
  ['lib/components/layout/mobile-navigation-header.tsx', 1],
  ['app/(timeline)/PublicTopBar.tsx', 1],
  ['app/u/heatmaps/[token]/SharedHeatmapPage.tsx', 1],
  ['app/(timeline)/[actor]/[status]/Header.tsx', 1],
  ['app/(timeline)/[actor]/[status]/loading.tsx', 1]
]

const countOf = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].length

describe('Surface Chrome usage', () => {
  it.each(CHROME_BARS)(
    '%s uses bg-surface-chrome on its bars',
    (file, bars) => {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(countOf(source, /\bbg-surface-chrome\b/g)).toBe(bars)
      expect(countOf(source, /\bbg-background\/(85|90)\b/g)).toBe(0)
    }
  )
})
