/** Feather 0..100 is a gaussian sigma of up to 2% of the frame's long edge. */
export const FEATHER_MAX_FRACTION = 0.02

/** Sigma, in pixels of a frame whose long edge is `longEdge`. */
export const featherSigma = (feather: number, longEdge: number): number =>
  (Math.min(100, Math.max(0, feather)) / 100) * FEATHER_MAX_FRACTION * longEdge

/**
 * The CPU twin of the mask blur pass in the shader: a separable gaussian over
 * one channel, with the kernel cut at ceil(3 sigma) and the edge pixel
 * repeating past the frame. The editor blurs in GL; this is the reference
 * the tests hold the shader to.
 */
export const gaussianBlur = (
  data: ArrayLike<number>,
  width: number,
  height: number,
  sigma: number
): Float32Array => {
  const source = Float32Array.from(data)
  const reach = sigma > 0 ? Math.ceil(3 * sigma) : 0
  if (reach === 0) return source
  const weights: number[] = []
  let total = 0
  for (let i = -reach; i <= reach; i += 1) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma))
    weights.push(weight)
    total += weight
  }
  const horizontal = new Float32Array(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let i = -reach; i <= reach; i += 1) {
        const sx = Math.min(width - 1, Math.max(0, x + i))
        sum += source[y * width + sx] * weights[i + reach]
      }
      horizontal[y * width + x] = sum / total
    }
  }
  const result = new Float32Array(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let i = -reach; i <= reach; i += 1) {
        const sy = Math.min(height - 1, Math.max(0, y + i))
        sum += horizontal[sy * width + x] * weights[i + reach]
      }
      result[y * width + x] = sum / total
    }
  }
  return result
}
