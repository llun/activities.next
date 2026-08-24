'use client'

import { decode } from 'blurhash'
import { CSSProperties, FC, useEffect, useRef } from 'react'

interface Props {
  blurhash: string
  className?: string
  style?: CSSProperties
  width?: number
  height?: number
}

export const BlurhashCanvas: FC<Props> = ({
  blurhash,
  className,
  style,
  width = 32,
  height = 32
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !blurhash) return

    try {
      const pixels = decode(blurhash, width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const imageData = ctx.createImageData(width, height)
      imageData.data.set(pixels)
      ctx.putImageData(imageData, 0, 0)
    } catch {
      // Decode error gracefully falls back to empty canvas
    }
  }, [blurhash, width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={style}
      aria-hidden="true"
    />
  )
}
