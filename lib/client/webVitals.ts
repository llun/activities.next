import type { WebVitalsReport } from '@/lib/utils/webVitals/types'

export const WEB_VITALS_PATH = '/api/v1/web-vitals'

/**
 * Sends a Web Vitals report to the server, fire and forget. A beacon survives
 * the page being closed, which is when the final values exist; `fetch` with
 * `keepalive` is the fallback where beacons are missing or refuse the payload.
 * It never throws and reports nothing back: telemetry must not affect the
 * page, so a failed or unsupported transport just loses the sample.
 */
export const sendWebVitalsReport = (report: WebVitalsReport): void => {
  try {
    const body = JSON.stringify(report)

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function' &&
      typeof Blob !== 'undefined' &&
      navigator.sendBeacon(
        WEB_VITALS_PATH,
        new Blob([body], { type: 'application/json' })
      )
    ) {
      return
    }

    if (typeof fetch === 'function') {
      fetch(WEB_VITALS_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        credentials: 'omit',
        keepalive: true
      }).catch(() => {})
    }
  } catch {
    // Nothing to recover: the sample is lost.
  }
}
