'use client'

import { type ComponentType, useEffect, useState } from 'react'

type Reporter = ComponentType

/**
 * Tiny client entry in the root layout's bundle that decides once per page load
 * whether to sample Web Vitals. Only sampled page loads download the reporter
 * chunk (`WebVitalsReporter`, `webVitalsCollector`, and `web-vitals`); unsampled
 * page loads download only this small loader and register no observers.
 */
export function WebVitalsLoader({ sampleRate }: { sampleRate: number }) {
  const [sampled] = useState(() => Math.random() < sampleRate)
  const [Reporter, setReporter] = useState<Reporter | null>(null)

  useEffect(() => {
    if (!sampled) return

    let active = true
    void import('./WebVitalsReporter')
      .then((module) => {
        if (active) setReporter(() => module.WebVitalsReporter)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [sampled])

  return sampled && Reporter ? <Reporter /> : null
}
