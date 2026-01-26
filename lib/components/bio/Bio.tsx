'use client'

import { FC } from 'react'

import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

interface Props {
  summary: string
}

export const Bio: FC<Props> = ({ summary }) => {
  const bio = cleanClassName(sanitizeText(summary))
  return <>{bio}</>
}
