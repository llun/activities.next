'use client'

import { FC, useState } from 'react'

import { switchActor } from '@/lib/client'
import { setActiveOfflineSession } from '@/lib/client/offline'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'

interface Props {
  actorId: string
  handle: string
}

/**
 * "Edit profile" on another profile of the signed-in account. The editor works
 * on the active actor, so this switches to the profile first, the way the actor
 * switcher does, then loads the editor with a full navigation (the new actor
 * has to be read from the cookie) and `?switched=1` for its notice.
 */
export const EditOwnedProfileButton: FC<Props> = ({ actorId, handle }) => {
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onClick = async () => {
    if (isSwitching) return
    setIsSwitching(true)
    setError(null)
    try {
      const didSwitch = await switchActor({ actorId })
      if (!didSwitch) {
        setError(`Failed to switch to ${handle}`)
        setIsSwitching(false)
        return
      }
      try {
        await setActiveOfflineSession({ actorId })
      } catch {
        // safe ignore, as in the actor switcher
      }
      window.location.assign('/settings/profile?switched=1')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to switch to ${handle}`
      )
      setIsSwitching(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="shrink-0"
        disabled={isSwitching}
        onClick={onClick}
      >
        Edit profile
      </Button>
      {error ? <Alert title={error} /> : null}
    </div>
  )
}
