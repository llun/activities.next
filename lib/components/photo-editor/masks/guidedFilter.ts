const computeIntegral = (
  src: Float32Array,
  width: number,
  height: number,
  integral: Float64Array
) => {
  const stride = width + 1
  integral.fill(0, 0, stride)
  for (let y = 0; y < height; y += 1) {
    const rowOffset = (y + 1) * stride
    const prevRowOffset = y * stride
    const srcRow = y * width
    let sum = 0
    integral[rowOffset] = 0
    for (let x = 0; x < width; x += 1) {
      sum += src[srcRow + x]
      integral[rowOffset + x + 1] = integral[prevRowOffset + x + 1] + sum
    }
  }
}

const boxFilter = (
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  integral: Float64Array,
  dst: Float32Array
): Float32Array => {
  computeIntegral(src, width, height, integral)
  const stride = width + 1
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height, y + radius + 1)
    const y0Offset = y0 * stride
    const y1Offset = y1 * stride
    const dstRow = y * width
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width, x + radius + 1)
      const sum =
        integral[y1Offset + x1] -
        integral[y0Offset + x1] -
        integral[y1Offset + x0] +
        integral[y0Offset + x0]
      const count = (x1 - x0) * (y1 - y0)
      dst[dstRow + x] = sum / count
    }
  }
  return dst
}

export const refineMaskWithGuide = (
  mask: Uint8ClampedArray,
  guideRgba: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 4,
  eps = 0.002
): Uint8ClampedArray => {
  const count = width * height
  if (
    count === 0 ||
    mask.length < count ||
    guideRgba.length < count * 4 ||
    radius <= 0
  ) {
    return new Uint8ClampedArray(mask)
  }

  const I = new Float32Array(count)
  const p = new Float32Array(count)

  for (let i = 0; i < count; i += 1) {
    const r = guideRgba[i * 4]
    const g = guideRgba[i * 4 + 1]
    const b = guideRgba[i * 4 + 2]
    I[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    p[i] = mask[i] / 255
  }

  const integral = new Float64Array((width + 1) * (height + 1))
  const meanI = new Float32Array(count)
  const meanP = new Float32Array(count)
  const corrI = new Float32Array(count)
  const corrIp = new Float32Array(count)
  const temp = new Float32Array(count)

  boxFilter(I, width, height, radius, integral, meanI)
  boxFilter(p, width, height, radius, integral, meanP)

  for (let i = 0; i < count; i += 1) temp[i] = I[i] * I[i]
  boxFilter(temp, width, height, radius, integral, corrI)

  for (let i = 0; i < count; i += 1) temp[i] = I[i] * p[i]
  boxFilter(temp, width, height, radius, integral, corrIp)

  const a = new Float32Array(count)
  const b = new Float32Array(count)

  for (let i = 0; i < count; i += 1) {
    const varI = Math.max(0, corrI[i] - meanI[i] * meanI[i])
    const covIp = corrIp[i] - meanI[i] * meanP[i]
    const aVal = covIp / (varI + eps)
    a[i] = aVal
    b[i] = meanP[i] - aVal * meanI[i]
  }

  const meanA = new Float32Array(count)
  const meanB = new Float32Array(count)

  boxFilter(a, width, height, radius, integral, meanA)
  boxFilter(b, width, height, radius, integral, meanB)

  const out = new Uint8ClampedArray(count)

  for (let i = 0; i < count; i += 1) {
    const q = meanA[i] * I[i] + meanB[i]
    const stretched = Math.min(1, Math.max(0, (q - 0.1) / 0.8))
    out[i] = Math.round(stretched * 255)
  }

  return out
}
