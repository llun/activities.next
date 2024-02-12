'use client'

import { FC } from 'react'

import { deleteSession } from '@/lib/client'
import { Button } from '@/lib/components/Button'
import { Session } from '@/lib/models/session'

interface Props {
  existingSession: Session
}

export const DeleteSessionButton: FC<Props> = ({ existingSession }) => (
  <Button
    variant="link"
    onClick={async () => {
      await deleteSession({ token: existingSession.token })
      window.location.reload()
    }}
  >
    Delete
  </Button>
)
