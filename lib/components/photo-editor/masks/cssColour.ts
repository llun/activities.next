export type Rgb01 = [number, number, number]

/**
 * Resolves a CSS colour (a `var(--token)`, hsl, oklch...) to sRGB 0..1 by
 * painting it on a 1 x 1 canvas. Falls back to `fallback` when the browser
 * has no 2D canvas.
 */
export const resolveCssColour = (
  colour: string,
  fallback: Rgb01,
  host: Element = document.body
): Rgb01 => {
  try {
    const probe = document.createElement('span')
    probe.style.color = colour
    probe.style.display = 'none'
    host.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    host.removeChild(probe)
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { colorSpace: 'srgb' })
    if (!context) return fallback
    context.fillStyle = resolved
    context.fillRect(0, 0, 1, 1)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    return [r / 255, g / 255, b / 255]
  } catch {
    return fallback
  }
}
