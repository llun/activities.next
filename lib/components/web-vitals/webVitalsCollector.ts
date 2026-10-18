import { sendWebVitalsReport } from '@/lib/client/webVitals'
import {
  getWebVitalsDevice,
  getWebVitalsRoute,
  toWebVitalNavigationType
} from '@/lib/utils/webVitals/classify'
import {
  WEB_VITALS_MAX_METRICS_PER_REPORT,
  WEB_VITAL_MAX_VALUE,
  WEB_VITAL_NAMES,
  WEB_VITAL_RATINGS,
  type WebVitalMetricReport,
  type WebVitalName,
  type WebVitalRating,
  type WebVitalsReport
} from '@/lib/utils/webVitals/types'

// The most metrics one page load sends, soft navigations included.
export const WEB_VITALS_MAX_METRICS_PER_PAGE_LOAD = 30

// The fields of a `web-vitals` metric this module reads. Nothing else on the
// metric (entries, attribution, element selectors) is looked at.
export interface WebVitalsMetricInput {
  id: string
  name: string
  value: number
  rating?: string
  navigationType?: string
  navigationURL?: string
}

export interface WebVitalsCollectorOptions {
  send?: (report: WebVitalsReport) => void
  getViewportWidth?: () => number
  getPathname?: () => string
}

const isWebVitalName = (name: string): name is WebVitalName =>
  WEB_VITAL_NAMES.some((known) => known === name)

const isRating = (rating: unknown): rating is WebVitalRating =>
  WEB_VITAL_RATINGS.some((known) => known === rating)

// Only the pathname of the navigation's URL is read, and only to pick a route
// template; the URL itself, its query and its fragment go no further.
const pathnameOf = (url: string | undefined): string | null => {
  if (!url) return null
  try {
    return new URL(url, 'http://localhost').pathname
  } catch {
    return null
  }
}

const roundValue = (name: WebVitalName, value: number) =>
  name === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value)

/**
 * Collects LCP, CLS and INP for one page load and sends them in batches when
 * the page is hidden or unloaded. Each metric id is sent at most once, with
 * the latest value seen before the flush; a value that arrives after its id
 * was sent is dropped rather than sent twice. Everything it sends comes from
 * the fixed vocabularies in `lib/utils/webVitals/types`.
 */
export const createWebVitalsCollector = ({
  send = sendWebVitalsReport,
  getViewportWidth = () => window.innerWidth,
  getPathname = () => window.location.pathname
}: WebVitalsCollectorOptions = {}) => {
  const pending = new Map<string, WebVitalMetricReport>()
  const sentIds = new Set<string>()
  let accepted = 0
  let initialPathname: string | null = null

  const record = (metric: WebVitalsMetricInput): void => {
    try {
      if (
        !isWebVitalName(metric.name) ||
        !isRating(metric.rating) ||
        typeof metric.id !== 'string' ||
        !Number.isFinite(metric.value) ||
        metric.value < 0 ||
        metric.value > WEB_VITAL_MAX_VALUE[metric.name] ||
        sentIds.has(metric.id)
      ) {
        return
      }
      if (
        !pending.has(metric.id) &&
        accepted + pending.size >= WEB_VITALS_MAX_METRICS_PER_PAGE_LOAD
      ) {
        return
      }

      pending.set(metric.id, {
        name: metric.name,
        value: roundValue(metric.name, metric.value),
        rating: metric.rating,
        navigationType: toWebVitalNavigationType(metric.navigationType),
        route: getWebVitalsRoute(
          pathnameOf(metric.navigationURL) ?? initialPathname ?? getPathname()
        ),
        device: getWebVitalsDevice(getViewportWidth())
      })
    } catch {
      // A metric that cannot be read is skipped; the page is never affected.
    }
  }

  const flush = (): void => {
    try {
      if (pending.size === 0) return
      const metrics = [...pending.values()]
      for (const id of pending.keys()) sentIds.add(id)
      accepted += pending.size
      pending.clear()

      for (
        let start = 0;
        start < metrics.length;
        start += WEB_VITALS_MAX_METRICS_PER_REPORT
      ) {
        send({
          metrics: metrics.slice(
            start,
            start + WEB_VITALS_MAX_METRICS_PER_REPORT
          )
        })
      }
    } catch {
      // The samples are lost; the page is never affected.
    }
  }

  // Starts listening for the page being hidden. Web-vitals reports the final
  // LCP, CLS and INP from its own `visibilitychange` listener, which may run
  // after this one, so a deferred flush picks up whatever it reports then.
  const start = (): (() => void) => {
    initialPathname = getPathname()
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return
      flush()
      setTimeout(flush, 0)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', flush)
    }
  }

  return { record, flush, start }
}
