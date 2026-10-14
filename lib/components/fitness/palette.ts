// Fixed data colours for the fitness charts. These encode which series a line,
// crosshair dot or legend chip belongs to, so they are the same in light and
// dark and deliberately do not come from the theme tokens (a theme token says
// "error" or "success", never "this is the heart-rate line"). The surface-kit
// guard (`lib/components/surface/surfaceKitUsage.test.ts`) skips exactly this
// file; any other raw palette colour in the app is a failure.
//
// Every value is a mid-tone (the 400/500 step) so the same class reads on the
// light and the dark page background alike.

export type AnalysisSeriesKey =
  | 'elevation'
  | 'speed'
  | 'power'
  | 'heart-rate'
  | 'cadence'
  | 'temperature'
  | 'grade'

export interface AnalysisSeriesColour {
  /** The line, as an SVG `stroke-*` utility. */
  stroke: string
  /** An area under the line, or a bar, as an SVG `fill-*` utility. */
  fill: string
  /** The hover dot, the legend swatch and an HTML bar. */
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
    fill: 'fill-slate-400',
    dot: 'bg-slate-400',
    chipBorder: 'border-slate-400'
  },
  speed: {
    stroke: 'stroke-sky-500',
    fill: 'fill-sky-500',
    dot: 'bg-sky-500',
    chipBorder: 'border-sky-500'
  },
  power: {
    stroke: 'stroke-violet-500',
    fill: 'fill-violet-500',
    dot: 'bg-violet-500',
    chipBorder: 'border-violet-500'
  },
  'heart-rate': {
    stroke: 'stroke-rose-500',
    fill: 'fill-rose-500',
    dot: 'bg-rose-500',
    chipBorder: 'border-rose-500'
  },
  cadence: {
    stroke: 'stroke-emerald-500',
    fill: 'fill-emerald-500',
    dot: 'bg-emerald-500',
    chipBorder: 'border-emerald-500'
  },
  temperature: {
    stroke: 'stroke-amber-500',
    fill: 'fill-amber-500',
    dot: 'bg-amber-500',
    chipBorder: 'border-amber-500'
  },
  grade: {
    stroke: 'stroke-indigo-400',
    fill: 'fill-indigo-400',
    dot: 'bg-indigo-400',
    chipBorder: 'border-indigo-400'
  }
}

/** The chart colour when a chart is drawn without a series of its own. */
export const DEFAULT_ANALYSIS_SERIES_COLOUR = ANALYSIS_SERIES_COLOURS.speed
