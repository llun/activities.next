'use client'

import { FC, useMemo } from 'react'

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
      className="w-full"
      preserveAspectRatio="none"
    >
      <path d={areaPath} fill={color} fillOpacity={0.15} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
