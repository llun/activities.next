'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'

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
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm text-muted-foreground">
            {isDefaultActor
              ? 'This is your default actor and cannot be deleted. Set another actor as default first.'
              : 'This is your only actor and cannot be deleted.'}
          </p>
        </div>
      </div>
    )
  }

  // If already being deleted, show status
  if (deletionStatus) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm text-muted-foreground">
            {deletionStatus === 'deleting'
              ? 'This actor is currently being deleted...'
              : 'This actor is scheduled for deletion.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm text-muted-foreground">
            Permanently delete this actor and all associated data.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setIsDialogOpen(true)}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Actor
        </Button>
      </div>

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
