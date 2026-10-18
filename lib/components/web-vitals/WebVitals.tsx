import { getWebVitalsConfig } from '@/lib/config'

import { WebVitalsReporter } from './WebVitalsReporter'

/**
 * Server half of Web Vitals reporting: mounts the reporter only while the
 * sample rate is above zero. Dynamic routes already render per request, so
 * `getWebVitalsConfig()` reads the runtime value there without calling
 * `connection()`, while prerendered static pages (such as `/_not-found`) stay
 * static and use the build-time value (normally 0 = off). Render it inside a
 * `Suspense` boundary so it never holds up the page shell.
 */
export function WebVitals() {
  const { sampleRate } = getWebVitalsConfig()
  if (sampleRate <= 0) return null

  return <WebVitalsReporter sampleRate={sampleRate} />
}
