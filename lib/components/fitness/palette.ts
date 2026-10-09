// Fixed data colours for the fitness charts. These encode which series a line,
// crosshair dot or legend chip belongs to, so they are the same in light and
// dark and deliberately do not come from the theme tokens (a theme token says
// "error" or "success", never "this is the heart-rate line"). The surface-kit
// guard (`lib/components/surface/surfaceKitUsage.test.ts`) skips exactly this
// file; any other raw palette colour in the app is a failure.

export type AnalysisSeriesKey = 'elevation' | 'speed' | 'power' | 'heart-rate'

export interface AnalysisSeriesColour {
  /** The line, as an SVG `stroke-*` utility. */
  stroke: string
  /** The hover dot and the legend swatch. */
  dot: string
  /** A selected picker chip's and the combined legend's border. */
  chipBorder: string
}

// One colour per series, used for the line, the hover crosshair and the hover
// dot alike, so a stacked graph is identifiable by its own colour rather than
// every crosshair sharing the speed chart's blue.
export const ANALYSIS_SERIES_COLOURS: Record<
  AnalysisSeriesKey,
  AnalysisSeriesColour
> = {
  elevation: {
    stroke: 'stroke-slate-400',
    dot: 'bg-slate-400',
    chipBorder: 'border-slate-400'
  },
  speed: {
    stroke: 'stroke-sky-500',
    dot: 'bg-sky-500',
    chipBorder: 'border-sky-500'
  },
  power: {
    stroke: 'stroke-violet-500',
    dot: 'bg-violet-500',
    chipBorder: 'border-violet-500'
  },
  'heart-rate': {
    stroke: 'stroke-rose-500',
    dot: 'bg-rose-500',
    chipBorder: 'border-rose-500'
  }
}

/** The chart colour when a chart is drawn without a series of its own. */
export const DEFAULT_ANALYSIS_SERIES_COLOUR = ANALYSIS_SERIES_COLOURS.speed
