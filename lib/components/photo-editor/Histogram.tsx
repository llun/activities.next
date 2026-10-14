import { useMemo } from 'react'

import type { Histogram as HistogramData } from './engine/histogram'
import {
  CHANNEL_COLOURS,
  CHANNEL_FILL_OPACITY,
  GUIDE_STROKE,
  HISTOGRAM_FRAME_CLASS,
  LUMA_STROKE
} from './histogramPalette'
import {
  HISTOGRAM_HEIGHT,
  HISTOGRAM_WIDTH,
  buildHistogramShape,
  clipColour,
  clippedChannels
} from './histogramShape'

const GUIDES = [0.25, 0.5, 0.75]

const NO_CLIP = { r: false, g: false, b: false }

const ClipIndicator = ({
  side,
  colour,
  label
}: {
  side: 'left' | 'right'
  colour: string
  label: string
}) => (
  <svg
    role="img"
    aria-label={label}
    viewBox="0 0 10 10"
    className={`absolute top-1 size-2.5 ${side === 'left' ? 'left-1' : 'right-1'}`}
  >
    <title>{label}</title>
    <polygon
      points={side === 'left' ? '0,0 10,0 0,10' : '0,0 10,0 10,10'}
      fill={colour}
    />
  </svg>
)

/**
 * An RGB histogram on a fixed dark frame (both themes), so the additive
 * blending reads the standard way: red, green and blue areas in their own
 * colours that overlap to yellow, cyan and magenta, and to grey/white where
 * all three agree. Luma is a thin outline on top. The 128 bins are drawn as a
 * smooth, lightly smoothed curve with square-root scaling against one shared
 * peak that ignores the two end bins. Small triangles in the top corners light
 * up in the clipping channels' colour when more than 0.1% of the pixels are
 * crushed to 0 (left) or blown to 255 (right).
 */
export const Histogram = ({ data }: { data: HistogramData | null }) => {
  const shape = useMemo(() => (data ? buildHistogramShape(data) : null), [data])
  const shadows = data ? clippedChannels(data.clipLow, data.total) : NO_CLIP
  const highlights = data ? clippedChannels(data.clipHigh, data.total) : NO_CLIP
  const shadowsOn = shadows.r || shadows.g || shadows.b
  const highlightsOn = highlights.r || highlights.g || highlights.b

  const state = [
    shadowsOn ? 'shadows clipped' : null,
    highlightsOn ? 'highlights clipped' : null
  ].filter(Boolean)
  const label = state.length ? `Histogram, ${state.join(', ')}` : 'Histogram'

  return (
    <div className="relative">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${HISTOGRAM_WIDTH} ${HISTOGRAM_HEIGHT}`}
        preserveAspectRatio="none"
        className={`isolate block h-20 w-full rounded-md ${HISTOGRAM_FRAME_CLASS}`}
      >
        {GUIDES.map((guide) => (
          <line
            key={guide}
            data-testid="histogram-guide"
            x1={guide * HISTOGRAM_WIDTH}
            x2={guide * HISTOGRAM_WIDTH}
            y1={0}
            y2={HISTOGRAM_HEIGHT}
            stroke={GUIDE_STROKE}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {shape ? (
          <>
            <path
              data-testid="histogram-r"
              d={shape.r}
              fill={CHANNEL_COLOURS.r}
              fillOpacity={CHANNEL_FILL_OPACITY}
              className="mix-blend-screen"
            />
            <path
              data-testid="histogram-g"
              d={shape.g}
              fill={CHANNEL_COLOURS.g}
              fillOpacity={CHANNEL_FILL_OPACITY}
              className="mix-blend-screen"
            />
            <path
              data-testid="histogram-b"
              d={shape.b}
              fill={CHANNEL_COLOURS.b}
              fillOpacity={CHANNEL_FILL_OPACITY}
              className="mix-blend-screen"
            />
            <path
              data-testid="histogram-luma"
              d={shape.luma}
              fill="none"
              stroke={LUMA_STROKE}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}
      </svg>
      <ClipIndicator
        side="left"
        colour={clipColour(shadows)}
        label={shadowsOn ? 'Shadows clipped' : 'No shadow clipping'}
      />
      <ClipIndicator
        side="right"
        colour={clipColour(highlights)}
        label={highlightsOn ? 'Highlights clipped' : 'No highlight clipping'}
      />
    </div>
  )
}
