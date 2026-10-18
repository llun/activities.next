// Browser Web Vitals reporting (see docs/architecture.md → Browser Web Vitals).
// Both values are read from the environment on every call, at runtime: the
// layout and the report endpoint must never see a build-time value.

export const DEFAULT_WEB_VITALS_MAX_REPORTS_PER_MINUTE = 600
const MAX_WEB_VITALS_REPORTS_PER_MINUTE = 1_000_000

export type WebVitalsConfig = {
  /** Share of page loads that report, 0 (off) to 1 (every page load). */
  sampleRate: number
  /** Per-process cap on reports the endpoint accepts in one minute. */
  maxReportsPerMinute: number
}

export const getWebVitalsConfig = ({
  onInvalid
}: { onInvalid?: (message: string) => void } = {}): WebVitalsConfig => {
  let sampleRate = 0
  const rawRate = process.env.ACTIVITIES_WEB_VITALS_SAMPLE_RATE?.trim()
  if (rawRate) {
    const parsed = Number(rawRate)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      sampleRate = parsed
    } else {
      onInvalid?.(
        'ACTIVITIES_WEB_VITALS_SAMPLE_RATE must be a number from 0 to 1; Web Vitals reporting is off'
      )
    }
  }

  let maxReportsPerMinute = DEFAULT_WEB_VITALS_MAX_REPORTS_PER_MINUTE
  const rawMax =
    process.env.ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE?.trim()
  if (rawMax) {
    const parsed = Number(rawMax)
    if (
      Number.isInteger(parsed) &&
      parsed >= 1 &&
      parsed <= MAX_WEB_VITALS_REPORTS_PER_MINUTE
    ) {
      maxReportsPerMinute = parsed
    } else {
      onInvalid?.(
        `ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE must be an integer from 1 to ${MAX_WEB_VITALS_REPORTS_PER_MINUTE}; using the default ${DEFAULT_WEB_VITALS_MAX_REPORTS_PER_MINUTE}`
      )
    }
  }

  return { sampleRate, maxReportsPerMinute }
}
