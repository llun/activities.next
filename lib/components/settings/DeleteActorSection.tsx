'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { Frame } from '@/lib/components/surface/Frame'
import { Button } from '@/lib/components/ui/button'

import { DeleteActorDialog } from './DeleteActorDialog'

interface DeleteActorSectionProps {
  actorId: string
  actorUsername: string
  actorDomain: string
  isDefaultActor: boolean
  isOnlyActor: boolean
  deletionStatus: string | null
}

/**
 * The body of Settings › General › Danger zone: one frame holding a row for
 * the irreversible action. Deleting is an error-tone alert whose action is the
 * destructive button; when the actor cannot be deleted, or is already going,
 * the row says so without offering the button.
 */
export function DeleteActorSection({
  actorId,
  actorUsername,
  actorDomain,
  isDefaultActor,
  isOnlyActor,
  deletionStatus
}: DeleteActorSectionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  // Don't show delete button if this is the default or only actor
  if (isDefaultActor || isOnlyActor) {
    return (
      <Frame>
        <p className="text-muted-foreground px-4 py-4 text-sm">
          {isDefaultActor
            ? 'This is your default actor and cannot be deleted. Set another actor as default first.'
            : 'This is your only actor and cannot be deleted.'}
        </p>
      </Frame>
    )
  }

  // If already being deleted, show status
  if (deletionStatus) {
    return (
      <Frame className="overflow-hidden">
        <Alert tone="warning" title="Deletion in progress" flush>
          {deletionStatus === 'deleting'
            ? 'This actor is currently being deleted...'
            : 'This actor is scheduled for deletion.'}
        </Alert>
      </Frame>
    )
  }

  return (
    <>
      <Frame className="overflow-hidden">
        <Alert
          title="Delete this actor"
          flush
          action={
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setIsDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete actor
            </Button>
          }
        >
          Permanently delete this actor and all associated data.
        </Alert>
      </Frame>

      <DeleteActorDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        actorId={actorId}
        actorUsername={actorUsername}
        actorDomain={actorDomain}
      />
    </>
  )
}
