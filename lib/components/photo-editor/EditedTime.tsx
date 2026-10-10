'use client'

import { formatDistanceStrict } from 'date-fns/formatDistanceStrict'
import { useEffect, useState } from 'react'

/** "just now" under a minute, otherwise "2 minutes ago". */
export const formatEditedAgo = (date: Date, now: number = Date.now()) =>
  now - date.getTime() < 60_000
    ? 'just now'
    : formatDistanceStrict(date, now, { addSuffix: true })

/** When a photo was edited, kept current while the page stays open. */
export const EditedTime = ({ date }: { date: Date }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return <time dateTime={date.toISOString()}>{formatEditedAgo(date, now)}</time>
}
