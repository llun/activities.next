import { z } from 'zod'

import {
  WEB_VITALS_MAX_METRICS_PER_REPORT,
  WEB_VITAL_DEVICES,
  WEB_VITAL_MAX_VALUE,
  WEB_VITAL_NAMES,
  WEB_VITAL_NAVIGATION_TYPES,
  WEB_VITAL_RATINGS,
  WEB_VITAL_ROUTES
} from '@/lib/utils/webVitals/types'

const MetricReport = z
  .strictObject({
    name: z.enum(WEB_VITAL_NAMES),
    value: z.number().finite().min(0),
    rating: z.enum(WEB_VITAL_RATINGS),
    navigationType: z.enum(WEB_VITAL_NAVIGATION_TYPES),
    route: z.enum(WEB_VITAL_ROUTES),
    device: z.enum(WEB_VITAL_DEVICES)
  })
  .refine((metric) => metric.value <= WEB_VITAL_MAX_VALUE[metric.name], {
    path: ['value'],
    message: 'Value out of range'
  })

export const WebVitalsReportSchema = z.strictObject({
  metrics: z.array(MetricReport).min(1).max(WEB_VITALS_MAX_METRICS_PER_REPORT)
})
