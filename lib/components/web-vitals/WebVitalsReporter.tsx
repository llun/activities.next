'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { useEffect, useState } from 'react'

import { createWebVitalsCollector } from './webVitalsCollector'

// Collects this page load's metrics. It only mounts for a sampled page load,
// so the others register no observers at all.
function SampledWebVitals() {
  const [collector] = useState(() => createWebVitalsCollector())

  useReportWebVitals(collector.record)

  // After `useReportWebVitals`' own effect, so the collector's
  // `visibilitychange` listener is added after web-vitals'.
  useEffect(() => collector.start(), [collector])

  return null
}

/**
 * Reports a sample of page loads' LCP, CLS and INP to the server (see
 * "Browser Web Vitals" in docs/architecture.md). Mounted by the root layout
 * only while `ACTIVITIES_WEB_VITALS_SAMPLE_RATE` is above zero. Each page load
 * rolls the dice once; it renders nothing either way.
 */
export function WebVitalsReporter({ sampleRate }: { sampleRate: number }) {
  const [sampled] = useState(() => Math.random() < sampleRate)

  return sampled ? <SampledWebVitals /> : null
}
