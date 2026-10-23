'use client'

import { useRouter } from 'next/navigation'
import { FC } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'

export const EDIT_PROFILE_PATH = '/settings/profile'

interface Props {
  handle: string
}

/**
 * "Edit profile" on another profile you own switches to it first and lands on
 * the page with `?switched=1`. The notice goes away on Dismiss (the query is
 * dropped from the address) and, through the editor, after the first save.
 */
export const SwitchedNotice: FC<Props> = ({ handle }) => {
  const router = useRouter()
  return (
    <Alert
      tone="info"
      title={`Switched to ${handle}.`}
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.replace(EDIT_PROFILE_PATH)}
        >
          Dismiss
        </Button>
      }
    >
      You’re now posting as this profile.
    </Alert>
  )
}
