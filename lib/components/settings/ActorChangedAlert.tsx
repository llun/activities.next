'use client'

import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'

/** Shown when a request's actorId no longer matches the signed-in profile. */
export const ActorChangedAlert = () => (
  <Alert
    tone="info"
    title="Your active profile changed"
    action={
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => window.location.reload()}
      >
        Reload
      </Button>
    }
  >
    Reload the page to continue with the current profile.
  </Alert>
)
