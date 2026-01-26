'use client'

import { FC, useMemo } from 'react'

import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

interface Props {
  summary?: string | null
}

export const Bio: FC<Props> = ({ summary }) => {
  const bio = useMemo(
    () => cleanClassName(sanitizeText(summary || '')),
    [summary]
  )
  return (
    <div className="mt-4 text-sm leading-relaxed break-words [&_a]:text-sky-600 dark:[&_a]:text-sky-400 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-sky-700 dark:[&_a:hover]:text-sky-300 [&_p]:mb-4 last:[&_p]:mb-0">
      {bio}
    </div>
  )
}
