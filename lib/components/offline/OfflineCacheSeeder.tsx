'use client'

import { useEffect } from 'react'

import { getAccountBootstrap } from '@/lib/client/bootstrap'
import {
  type ClientBootstrapSnapshot,
  getOfflineTimeline,
  requestPersistentOfflineStorage,
  saveClientBootstrapSnapshot,
  saveOfflineTimeline,
  setActiveOfflineSession
} from '@/lib/client/offline'
import type { Status } from '@/lib/types/domain/status'
import type { TimelineContext } from '@/lib/types/domain/timeline'

export interface OfflineCacheSeederProps {
  actorId: string
  accountId?: string
  initialStatuses: Status[]
  initialTimelineContext?: TimelineContext
  initialNextMaxStatusId?: string | null
}

export function OfflineCacheSeeder({
  actorId,
  accountId,
  initialStatuses,
  initialTimelineContext,
  initialNextMaxStatusId
}: OfflineCacheSeederProps) {
  useEffect(() => {
    void requestPersistentOfflineStorage()
    void setActiveOfflineSession({ actorId, accountId })

    void (async () => {
      try {
        const existing = await getOfflineTimeline({
          actorId,
          timeline: 'home',
          filterKey: 'all'
        })

        if (!existing || existing.statuses.length === 0) {
          await saveOfflineTimeline({
            actorId,
            timeline: 'home',
            filterKey: 'all',
            segments: [
              {
                statuses: initialStatuses,
                nextMaxStatusId: initialNextMaxStatusId ?? null,
                prevMinStatusId: null
              }
            ],
            ancestorsById: initialTimelineContext?.ancestorsById || {},
            lastRefreshedAt: Date.now()
          })
        }
      } catch {
        // safe ignore
      }

      try {
        const snapshot = await getAccountBootstrap<ClientBootstrapSnapshot>()
        if (snapshot) {
          await saveClientBootstrapSnapshot(snapshot)
        }
      } catch {
        // safe ignore
      }
    })()
  }, [
    accountId,
    actorId,
    initialNextMaxStatusId,
    initialStatuses,
    initialTimelineContext
  ])

  return null
}
