'use client'

import { Activity, CalendarDays, Pencil } from 'lucide-react'
import { FC } from 'react'

import { GearProductLink } from '@/app/(timeline)/fitness/gear/GearProductLink'
import {
  formatGearDate,
  getGearDisplayName
} from '@/app/(timeline)/fitness/gear/gearUi'
import {
  FITNESS_STAT_STRIP_CLASS,
  FitnessStatCell
} from '@/lib/components/fitness/FitnessStatCell'
import { FitnessStatGrid } from '@/lib/components/fitness/FitnessStatGrid'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { formatInteger } from '@/lib/fitness/calendar/format'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

import {
  GearActivitiesFeed,
  type GearActivityFeedContext
} from './GearActivitiesFeed'

interface Props {
  gear: GearEntity
  backLink: React.ReactNode
  onEdit: () => void
  feed: GearActivityFeedContext
}

const getMetaLine = (gear: GearEntity): string =>
  [
    [gear.brand, gear.model].filter(Boolean).join(' '),
    gear.firstUsedAt === null
      ? null
      : `recording since ${formatGearDate(gear.firstUsedAt)}`
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * A recording device's page. It shares the gear route and the gear dialog, but
 * almost nothing else with a bike: there is no distance total (a head unit
 * records rides and runs alike, so one number would mean nothing), no
 * components, no default sports and no Retire — a device is not something you
 * choose for an activity, it is what captured it.
 *
 * With no components to switch to there is nothing to sub-navigate between, so
 * the page is its facts and then its activities — the design's device surface
 * has no view dropdown for the same reason. The activities are the shared feed
 * a bike's Activities view renders, so the same ride reads the same on either
 * page.
 */
export const DeviceDetailView: FC<Props> = ({
  gear,
  backLink,
  onEdit,
  feed
}) => {
  const metaLine = getMetaLine(gear)

  return (
    <div className="space-y-6">
      {backLink}

      <PageHeader
        title={getGearDisplayName(gear)}
        description={
          <div className="space-y-0.5">
            {metaLine && <div>{metaLine}</div>}
            <div>
              <GearProductLink productUrl={gear.productUrl} onEdit={onEdit} />
            </div>
          </div>
        }
        actions={
          // Edit only. A device cannot be retired, and deleting one would just
          // be recreated by the next upload from it.
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
        }
      />

      <FitnessStatGrid
        variant="summary"
        columns={2}
        className={FITNESS_STAT_STRIP_CLASS}
      >
        <FitnessStatCell
          label="Activities"
          icon={Activity}
          value={formatInteger(gear.activityCount)}
        />
        <FitnessStatCell
          label="First used"
          icon={CalendarDays}
          value={
            gear.firstUsedAt === null ? '—' : formatGearDate(gear.firstUsedAt)
          }
        />
      </FitnessStatGrid>

      <GearActivitiesFeed
        gearId={gear.id}
        emptyMessage="No recent activities recorded with this device."
        {...feed}
      />
    </div>
  )
}
