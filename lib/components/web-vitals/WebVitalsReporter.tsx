'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { useEffect, useState } from 'react'

import { createWebVitalsCollector } from './webVitalsCollector'

/**
 * Reports this page load's LCP, CLS and INP to the server (see
 * "Browser Web Vitals" in docs/architecture.md). Loaded on demand and mounted
 * by `WebVitalsLoader` only when this page load is sampled. Registers
 * web-vitals observers and renders nothing.
 */
export function WebVitalsReporter() {
  const [collector] = useState(() => createWebVitalsCollector())

  useReportWebVitals(collector.record)

  // After `useReportWebVitals`' own effect, so the collector's
  // `visibilitychange` listener is added after web-vitals'.
  useEffect(() => collector.start(), [collector])

  return null
}
