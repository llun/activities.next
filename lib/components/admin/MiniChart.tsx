'use client'

import { FC, useId, useMemo } from 'react'

interface Props {
  data: number[]
  color?: string
  height?: number
}

const buildPath = (values: number[], width: number, height: number): string => {
  if (values.length < 2) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = Math.max(1, max - min)
  const pad = 2

  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y =
        pad + height - pad * 2 - ((v - min) / range) * (height - pad * 2)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

const buildAreaPath = (
  values: number[],
  width: number,
  height: number
): string => {
  if (values.length < 2) return ''
  const linePath = buildPath(values, width, height)
  const lastX = width
  const firstX = 0
  return `${linePath} L ${lastX.toFixed(2)} ${height} L ${firstX} ${height} Z`
}

export const MiniChart: FC<Props> = ({
  data,
  color = 'currentColor',
  height = 40
}) => {
  const width = 200
  const gradientId = `mini-chart-fill-${useId()}`
  const linePath = useMemo(() => buildPath(data, width, height), [data, height])
  const areaPath = useMemo(
    () => buildAreaPath(data, width, height),
    [data, height]
  )

  if (data.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="none"
      />
    )
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full"
      preserveAspectRatio="none"
    >
      {/* The design's area fill: the line colour at 20% at the top of the
          chart, fading to transparent at the baseline. */}
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="0"
          y2={height}
        >
          <stop offset="0" stopColor={color} stopOpacity={0.2} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      {/* The SVG is stretched non-uniformly (preserveAspectRatio="none"), which
          would thicken the stroke on steep segments; non-scaling-stroke keeps
          it an even 1.5px everywhere. */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
