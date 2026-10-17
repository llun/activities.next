import { connection } from 'next/server'

import { getWebVitalsConfig } from '@/lib/config'

import { WebVitalsReporter } from './WebVitalsReporter'

/**
 * Server half of Web Vitals reporting: mounts the reporter only while the
 * sample rate is above zero. `connection()` makes the render per request, so
 * the rate is always the runtime value and never one baked in by a build or a
 * prerender. Render it inside a `Suspense` boundary so it never holds up the
 * page shell.
 */
export async function WebVitals() {
  await connection()
  const { sampleRate } = getWebVitalsConfig()
  if (sampleRate <= 0) return null

  return <WebVitalsReporter sampleRate={sampleRate} />
}
