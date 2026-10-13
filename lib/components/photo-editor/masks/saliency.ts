import type { MaskPoint } from '@/lib/services/medias/edit/recipe'

import { type Focus, focusToPoint } from './focusPoint'

const GRID_MAX = 48

export const detectSalientPoints = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  focus?: Focus | null
): MaskPoint[] => {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return [focusToPoint(focus)]
  }

  const scale = Math.min(1, GRID_MAX / Math.max(width, height))
  const gridW = Math.max(1, Math.round(width * scale))
  const gridH = Math.max(1, Math.round(height * scale))
  const cellCount = gridW * gridH

  const gridR = new Float32Array(cellCount)
  const gridG = new Float32Array(cellCount)
  const gridB = new Float32Array(cellCount)
  const gridLum = new Float32Array(cellCount)

  for (let gy = 0; gy < gridH; gy += 1) {
    const y0 = Math.floor((gy * height) / gridH)
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / gridH))
    for (let gx = 0; gx < gridW; gx += 1) {
      const x0 = Math.floor((gx * width) / gridW)
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / gridW))
      let sumR = 0
      let sumG = 0
      let sumB = 0
      const count = (x1 - x0) * (y1 - y0)
      for (let y = y0; y < y1; y += 1) {
        const row = y * width
        for (let x = x0; x < x1; x += 1) {
          const idx = (row + x) * 4
          sumR += rgba[idx]
          sumG += rgba[idx + 1]
          sumB += rgba[idx + 2]
        }
      }
      const r = sumR / count / 255
      const g = sumG / count / 255
      const b = sumB / count / 255
      const idx = gy * gridW + gx
      gridR[idx] = r
      gridG[idx] = g
      gridB[idx] = b
      gridLum[idx] = 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
  }

  // Estimate background border color distribution
  let borderCount = 0
  let sumBorderR = 0
  let sumBorderG = 0
  let sumBorderB = 0

  for (let gy = 0; gy < gridH; gy += 1) {
    for (let gx = 0; gx < gridW; gx += 1) {
      if (gx === 0 || gx === gridW - 1 || gy === 0 || gy === gridH - 1) {
        const idx = gy * gridW + gx
        sumBorderR += gridR[idx]
        sumBorderG += gridG[idx]
        sumBorderB += gridB[idx]
        borderCount += 1
      }
    }
  }

  const meanBorderR = borderCount > 0 ? sumBorderR / borderCount : 0.5
  const meanBorderG = borderCount > 0 ? sumBorderG / borderCount : 0.5
  const meanBorderB = borderCount > 0 ? sumBorderB / borderCount : 0.5

  const focusPt = focusToPoint(focus)
  const targetX = focus ? focusPt.x : 0.5
  const targetY = focus ? focusPt.y : 0.5

  const scores = new Float32Array(cellCount)
  let maxScore = 0
  let peakIdx = 0

  for (let gy = 0; gy < gridH; gy += 1) {
    const ny = (gy + 0.5) / gridH
    for (let gx = 0; gx < gridW; gx += 1) {
      const idx = gy * gridW + gx
      const nx = (gx + 0.5) / gridW

      const dr = gridR[idx] - meanBorderR
      const dg = gridG[idx] - meanBorderG
      const db = gridB[idx] - meanBorderB
      const colorDist = Math.sqrt(dr * dr + dg * dg + db * db)

      let neighborDiff = 0
      let neighborCount = 0
      const lum = gridLum[idx]
      const offsets = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1]
      ]
      for (const [ox, oy] of offsets) {
        const nxCell = gx + ox
        const nyCell = gy + oy
        if (nxCell >= 0 && nxCell < gridW && nyCell >= 0 && nyCell < gridH) {
          const nIdx = nyCell * gridW + nxCell
          neighborDiff += Math.abs(lum - gridLum[nIdx])
          neighborCount += 1
        }
      }
      const contrast = neighborCount > 0 ? neighborDiff / neighborCount : 0

      const dist = Math.hypot(nx - targetX, ny - targetY)
      const gaussian = Math.exp(-(dist * dist) / (2 * 0.35 * 0.35))
      const edgeDecay = Math.sin(Math.PI * nx) * Math.sin(Math.PI * ny)
      const spatialPrior = gaussian * Math.sqrt(Math.max(0, edgeDecay))

      const score = (colorDist * 0.7 + contrast * 0.3) * spatialPrior
      scores[idx] = score

      if (score > maxScore) {
        maxScore = score
        peakIdx = idx
      }
    }
  }

  // Uniform/flat image fallback
  if (maxScore < 0.01) {
    return [focusToPoint(focus)]
  }

  const peakGx = peakIdx % gridW
  const peakGy = Math.floor(peakIdx / gridW)
  const peakX = (peakGx + 0.5) / gridW
  const peakY = (peakGy + 0.5) / gridH

  let sumW = 0
  let sumX = 0
  let sumY = 0
  const threshold = 0.5 * maxScore

  for (let idx = 0; idx < cellCount; idx += 1) {
    if (scores[idx] >= threshold) {
      const w = scores[idx]
      const gx = idx % gridW
      const gy = Math.floor(idx / gridW)
      sumW += w
      sumX += ((gx + 0.5) / gridW) * w
      sumY += ((gy + 0.5) / gridH) * w
    }
  }

  const centroidX = sumW > 0 ? sumX / sumW : peakX
  const centroidY = sumW > 0 ? sumY / sumW : peakY

  const result: MaskPoint[] = [{ x: peakX, y: peakY, label: 1 }]

  if (Math.hypot(peakX - centroidX, peakY - centroidY) >= 0.08) {
    result.push({ x: centroidX, y: centroidY, label: 1 })
  }

  const corners = [
    { x: 0.06, y: 0.06 },
    { x: 0.94, y: 0.06 },
    { x: 0.06, y: 0.94 },
    { x: 0.94, y: 0.94 }
  ]

  const eligibleCorners = corners
    .map((corner) => {
      const cgx = Math.min(gridW - 1, Math.max(0, Math.floor(corner.x * gridW)))
      const cgy = Math.min(gridH - 1, Math.max(0, Math.floor(corner.y * gridH)))
      const idx = cgy * gridW + cgx
      const score = scores[idx]
      const dr = gridR[idx] - meanBorderR
      const dg = gridG[idx] - meanBorderG
      const db = gridB[idx] - meanBorderB
      const colorDist = Math.sqrt(dr * dr + dg * dg + db * db)
      return { corner, score, colorDist }
    })
    .filter((entry) => entry.score < 0.15 * maxScore && entry.colorDist < 0.25)
    .sort((a, b) => a.score - b.score)

  for (let i = 0; i < Math.min(2, eligibleCorners.length); i += 1) {
    result.push({
      x: eligibleCorners[i].corner.x,
      y: eligibleCorners[i].corner.y,
      label: 0
    })
  }

  return result
}

export const boxToPromptPoints = (box: {
  x0: number
  y0: number
  x1: number
  y1: number
}): MaskPoint[] => {
  const minX = Math.min(box.x0, box.x1)
  const maxX = Math.max(box.x0, box.x1)
  const minY = Math.min(box.y0, box.y1)
  const maxY = Math.max(box.y0, box.y1)
  const w = maxX - minX
  const h = maxY - minY
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  const clampUnit = (v: number) => Math.min(1, Math.max(0, v))
  const clampOuter = (v: number) => Math.min(0.99, Math.max(0.01, v))

  const marginX = Math.max(0.02, 0.05 * w)
  const marginY = Math.max(0.02, 0.05 * h)

  const positives: MaskPoint[] = [
    { x: clampUnit(cx), y: clampUnit(cy), label: 1 },
    { x: clampUnit(cx - 0.22 * w), y: clampUnit(cy - 0.22 * h), label: 1 },
    { x: clampUnit(cx + 0.22 * w), y: clampUnit(cy - 0.22 * h), label: 1 },
    { x: clampUnit(cx - 0.22 * w), y: clampUnit(cy + 0.22 * h), label: 1 },
    { x: clampUnit(cx + 0.22 * w), y: clampUnit(cy + 0.22 * h), label: 1 }
  ]

  const candidateNegatives: MaskPoint[] = [
    { x: clampOuter(minX - marginX), y: clampOuter(minY - marginY), label: 0 },
    { x: clampOuter(maxX + marginX), y: clampOuter(minY - marginY), label: 0 },
    { x: clampOuter(minX - marginX), y: clampOuter(maxY + marginY), label: 0 },
    { x: clampOuter(maxX + marginX), y: clampOuter(maxY + marginY), label: 0 }
  ]

  const negatives = candidateNegatives.filter(
    (pt) => pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY
  )

  return [...positives, ...negatives]
}
