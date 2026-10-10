import { useMemo } from 'react'

import type { Histogram as HistogramData } from './engine/histogram'

const WIDTH = 200
const HEIGHT = 64

const toPath = (bins: number[], peak: number) => {
  const step = WIDTH / bins.length
  const points = bins.map((count, index) => {
    const y = HEIGHT - Math.min(1, count / peak) * (HEIGHT - 2)
    return `L${(index * step).toFixed(1)} ${y.toFixed(1)} L${((index + 1) * step).toFixed(1)} ${y.toFixed(1)}`
  })
  return `M0 ${HEIGHT} ${points.join(' ')} L${WIDTH} ${HEIGHT} Z`
}

/**
 * Three overlaid channels and the luma, on a 64 px high frame. Colours come
 * from the `--chart-*` tokens. Each series is scaled to the tallest bin that
 * is not an end spike (a clipped sky should not flatten the rest).
 */
export const Histogram = ({ data }: { data: HistogramData | null }) => {
  const paths = useMemo(() => {
    if (!data) return null
    const inner = (bins: number[]) => bins.slice(1, -1)
    const peak = Math.max(
      1,
      ...inner(data.r),
      ...inner(data.g),
      ...inner(data.b),
      ...inner(data.luma)
    )
    return {
      r: toPath(data.r, peak),
      g: toPath(data.g, peak),
      b: toPath(data.b, peak),
      luma: toPath(data.luma, peak)
    }
  }, [data])

  return (
    <svg
      role="img"
      aria-label="Histogram"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-16 w-full rounded-md bg-muted"
    >
      {paths ? (
        <>
          <path
            d={paths.luma}
            className="fill-(--chart-4)"
            fillOpacity="0.35"
          />
          <path d={paths.r} className="fill-(--chart-1)" fillOpacity="0.45" />
          <path d={paths.g} className="fill-(--chart-2)" fillOpacity="0.45" />
          <path d={paths.b} className="fill-(--chart-3)" fillOpacity="0.45" />
        </>
      ) : null}
    </svg>
  )
}
