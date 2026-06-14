import { cn } from '@/lib/utils'

interface SparklineProps {
  // Daily values ordered oldest→newest.
  values: number[]
  width?: number
  height?: number
  className?: string
}

// A compact 7-day usage sparkline: a filled area under a primary-colored
// polyline. Colour comes from `currentColor` (defaults to the primary token)
// so callers can recolour with a text utility.
export const Sparkline = ({
  values,
  width = 62,
  height = 27,
  className
}: SparklineProps) => {
  // A line needs at least two points; with fewer, render nothing rather than a
  // degenerate (single-point / empty) polyline.
  if (values.length < 2) return null

  const max = Math.max(...values, 1)
  const lastIndex = values.length - 1
  const points = values.map((value, index): [number, number] => [
    (index / lastIndex) * (width - 2) + 1,
    height - 2 - (value / max) * (height - 6)
  ])
  const line = points
    .map((point) => point.map((coord) => coord.toFixed(1)).join(','))
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className={cn('shrink-0 text-primary', className)}
    >
      <polygon
        points={`1,${height - 1} ${line} ${width - 1},${height - 1}`}
        fill="currentColor"
        opacity="0.12"
      />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
