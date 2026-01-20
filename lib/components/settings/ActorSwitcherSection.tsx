'use client'

import { Check, Clock, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  ActorInfo,
  AddActorDialog
} from '@/lib/components/actor-switcher'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'

interface ActorSwitcherSectionProps {
  currentActor: ActorInfo
  actors: ActorInfo[]
}

export function ActorSwitcherSection({
  currentActor,
  actors
}: ActorSwitcherSectionProps) {
  const router = useRouter()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const getAvatarInitial = (username: string) => {
    if (!username) return '?'
    return username[0].toUpperCase()
  }

  const getHandle = (actor: ActorInfo) => `@${actor.username}@${actor.domain}`

  const handleSwitchActor = async (actorId: string) => {
    if (actorId === currentActor.id || isSwitching) return

    // Check if actor is pending deletion
    const actor = actors.find((a) => a.id === actorId)
    if (actor?.deletionStatus) return

    setIsSwitching(true)
    try {
      const response = await fetch('/api/v1/actors/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId })
      })

      if (response.ok) {
        window.location.reload()
      }
    } finally {
      setIsSwitching(false)
    }
  }

  const handleCancelDeletion = async (actorId: string) => {
    if (isCancelling) return

    setIsCancelling(true)
    try {
      const response = await fetch('/api/v1/actors/cancel-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId })
      })

      if (response.ok) {
        router.refresh()
      }
    } finally {
      setIsCancelling(false)
    }
  }

  const handleActorCreated = () => {
    setIsDialogOpen(false)
    window.location.reload()
  }

  return (
    <>
      <div className="space-y-3">
        {actors.map((actor) => {
          const isPendingDeletion = actor.deletionStatus === 'scheduled'
          const isDeleting = actor.deletionStatus === 'deleting'
          const isDisabled = isSwitching || isDeleting
          const reducedOpacity = isPendingDeletion || isDeleting
          const isCurrent = actor.id === currentActor.id

          return (
            <div
              key={actor.id}
              className={`flex items-center gap-3 rounded-lg border p-3 ${
                isCurrent ? 'border-primary bg-primary/5' : 'border-border'
              } ${isDisabled ? 'opacity-50' : ''}`}
            >
              <Avatar
                className={`h-10 w-10 ${reducedOpacity ? 'opacity-60' : ''}`}
              >
                {actor.iconUrl && <AvatarImage src={actor.iconUrl} />}
                <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 text-sm">
                  {getAvatarInitial(actor.username)}
                </AvatarFallback>
              </Avatar>
              <div
                className={`flex-1 overflow-hidden ${reducedOpacity ? 'opacity-60' : ''}`}
              >
                <p className="text-sm font-medium truncate">
                  {actor.name || actor.username}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {isPendingDeletion ? (
                    <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Pending deletion
                    </span>
                  ) : isDeleting ? (
                    <span className="text-destructive">Deleting...</span>
                  ) : (
                    getHandle(actor)
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isCurrent && !isPendingDeletion && !isDeleting && (
                  <Check className="h-4 w-4 text-primary" />
                )}
                {isPendingDeletion && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCancelDeletion(actor.id)}
                    disabled={isCancelling}
                  >
                    Cancel
                  </Button>
                )}
                {!isCurrent && !isPendingDeletion && !isDeleting && (
                  <Button
                    size="sm"
                    onClick={() => handleSwitchActor(actor.id)}
                    disabled={isSwitching}
                  >
                    Switch
                  </Button>
                )}
              </div>
            </div>
          )
        })}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add another actor
        </Button>
      </div>

      <AddActorDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        domain={currentActor.domain}
        onSuccess={handleActorCreated}
      />
    </>
  )
}
