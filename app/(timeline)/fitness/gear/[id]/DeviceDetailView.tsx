'use client'

import { Pencil } from 'lucide-react'
import { FC } from 'react'

import { GearProductLink } from '@/app/(timeline)/fitness/gear/GearProductLink'
import {
  formatGearDate,
  getGearDisplayName
} from '@/app/(timeline)/fitness/gear/gearUi'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Card } from '@/lib/components/ui/card'
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

const StatTile: FC<{ label: string; value: string }> = ({ label, value }) => (
  <Card className="flex min-w-0 flex-col gap-2 p-4">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-xl font-semibold tabular-nums">{value}</div>
  </Card>
)

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile label="Activities" value={String(gear.activityCount)} />
        <StatTile
          label="First used"
          value={
            gear.firstUsedAt === null ? '—' : formatGearDate(gear.firstUsedAt)
          }
        />
      </div>

      <GearActivitiesFeed
        gearId={gear.id}
        emptyMessage="No recent activities recorded with this device."
        {...feed}
      />
    </div>
  )
}
