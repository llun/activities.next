'use client'

import Link from 'next/link'
import { FC, useEffect, useState } from 'react'

import { listDrafts, subscribeDraftsMessages } from '@/lib/client/drafts'
import { useDrafts } from '@/lib/components/drafts/DraftsProvider'

interface Props {
  /** The draft being typed: it is not counted (it is already on screen). */
  excludeId?: string | null
}

/** "N drafts · Open" on the home composer's save-status row. */
export const DraftsLink: FC<Props> = ({ excludeId }) => {
  const drafts = useDrafts()
  const actorId = drafts?.actorId
  const accountId = drafts?.accountId
  const [ids, setIds] = useState<string[]>([])

  useEffect(() => {
    if (!actorId) return
    let current = true
    const refresh = () => {
      listDrafts({ actorId })
        .then((rows) => {
          if (current) setIds(rows.map((row) => row.id))
        })
        // Unavailable storage means there is nothing to open.
        .catch(() => {
          if (current) setIds([])
        })
    }
    refresh()
    const unsubscribe = subscribeDraftsMessages((message) => {
      if (message.accountId === accountId && message.type === 'changed') {
        refresh()
      }
    })
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      current = false
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [actorId, accountId])

  if (!drafts) return null
  const count = ids.filter((id) => id !== excludeId).length
  if (count === 0) return null

  return (
    <p className="text-xs text-muted-foreground">
      {count} {count === 1 ? 'draft' : 'drafts'} ·{' '}
      <Link href="/drafts" className="text-primary-text hover:underline">
        Open
      </Link>
    </p>
  )
}
