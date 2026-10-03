/**
 * WCAG 2.1 contrast ratio of two `#RRGGBB` colours (SC 1.4.3 uses 4.5:1 for
 * normal text). For tests that pin a literal colour pair.
 */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const contrastRatio = (foreground: string, background: string) => {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  )
  return (hi + 0.05) / (lo + 0.05)
}
