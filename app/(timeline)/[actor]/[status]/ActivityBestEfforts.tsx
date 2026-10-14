import { Trophy } from 'lucide-react'
import { FC } from 'react'

import { ANALYSIS_SERIES_COLOURS } from '@/lib/components/fitness/palette'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { StatCell } from '@/lib/components/surface/StatCell'
import {
  StatStrip,
  type StatStripColumns
} from '@/lib/components/surface/StatStrip'
import { cn } from '@/lib/utils'

import type { PowerEffort } from './fitnessActivityMetrics'

export const formatEffortDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const hours = seconds / 3600
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`
}

/**
 * The best average power held for 5 s, 1, 5, 20 and 60 min. A stat strip on a
 * tablet or desktop column; on a phone-width column, a list with a bar per
 * duration so the drop-off reads at a glance.
 */
export const ActivityBestEfforts: FC<{ efforts: PowerEffort[] }> = ({
  efforts
}) => {
  if (efforts.length === 0) return null
  const peak = Math.max(1, ...efforts.map((effort) => effort.watts))
  return (
    <Section id="best-efforts" title="Best efforts" icon={Trophy} meta="power">
      <StatStrip
        columns={efforts.length as StatStripColumns}
        className="hidden @min-[521px]:block"
      >
        {efforts.map((effort) => (
          <StatCell
            key={effort.durationSeconds}
            label={formatEffortDuration(effort.durationSeconds)}
            value={`${effort.watts} W`}
          />
        ))}
      </StatStrip>
      <Frame divided className="@min-[521px]:hidden">
        {efforts.map((effort) => (
          <div
            key={effort.durationSeconds}
            className="flex items-center gap-2 px-3 py-2 text-sm tabular-nums"
          >
            <span className="w-14 shrink-0 text-muted-foreground">
              {formatEffortDuration(effort.durationSeconds)}
            </span>
            <span
              aria-hidden="true"
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <span
                className={cn(
                  'block h-full rounded-full opacity-70',
                  ANALYSIS_SERIES_COLOURS.power.dot
                )}
                style={{ width: `${(effort.watts / peak) * 100}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-semibold">
              {effort.watts} W
            </span>
          </div>
        ))}
      </Frame>
    </Section>
  )
}
