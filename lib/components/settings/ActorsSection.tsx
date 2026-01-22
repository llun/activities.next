'use client'

import { Check, ChevronDown, Clock, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ActorInfo, AddActorDialog } from '@/lib/components/actor-switcher'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'

interface ActorsSectionProps {
  currentActor: ActorInfo
  actors: ActorInfo[]
  currentDefault: string | null
}

export function ActorsSection({
  currentActor,
  actors,
  currentDefault
}: ActorsSectionProps) {
  const router = useRouter()
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  // Initialize with currentDefault if it's in the actors list, otherwise use first actor
  const getInitialActorId = () => {
    if (currentDefault && actors.find((a) => a.id === currentDefault)) {
      return currentDefault
    }
    return actors[0]?.id || ''
  }

  const [selectedActorId, setSelectedActorId] =
    useState<string>(getInitialActorId())
  const [isSwitching, setIsSwitching] = useState(false)
  const [isSavingDefault, setIsSavingDefault] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const selectedActor =
    actors.find((actor) => actor.id === selectedActorId) || actors[0]

  const getAvatarInitial = (username: string) => {
    if (!username) return '?'
    return username[0].toUpperCase()
  }

  const getHandle = (actor: ActorInfo) => `@${actor.username}@${actor.domain}`

  const handleSwitchActor = async () => {
    if (selectedActorId === currentActor.id || isSwitching) return

    // Check if actor is pending deletion
    const actor = actors.find((a) => a.id === selectedActorId)
    if (actor?.deletionStatus) return

    setIsSwitching(true)
    setMessage(null)
    try {
      const response = await fetch('/api/v1/actors/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: selectedActorId })
      })

      if (response.ok) {
        window.location.reload()
      } else {
        setMessage({ type: 'error', text: 'Failed to switch actor' })
      }
    } catch {
      setMessage({ type: 'error', text: 'An error occurred' })
    } finally {
      setIsSwitching(false)
    }
  }

  const handleSaveDefault = async () => {
    if (!selectedActorId) return

    setIsSavingDefault(true)
    setMessage(null)

    try {
      const response = await fetch('/api/v1/actors/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: selectedActorId })
      })

      if (response.ok) {
        setMessage({ type: 'success', text: 'Default actor updated' })
        router.refresh()
      } else {
        setMessage({ type: 'error', text: 'Failed to update default actor' })
      }
    } catch {
      setMessage({ type: 'error', text: 'An error occurred' })
    } finally {
      setIsSavingDefault(false)
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

  const hasChanges = selectedActorId !== currentDefault
  const canSwitch =
    selectedActorId !== currentActor.id &&
    !actors.find((a) => a.id === selectedActorId)?.deletionStatus
  const hasMultipleActors = actors.length > 1

  return (
    <>
      <div className="space-y-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted cursor-pointer"
              disabled={isSwitching || isSavingDefault}
            >
              <Avatar className="h-10 w-10">
                {selectedActor?.iconUrl && (
                  <AvatarImage src={selectedActor.iconUrl} />
                )}
                <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  {getAvatarInitial(selectedActor?.username || '')}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium truncate">
                  {selectedActor?.name || selectedActor?.username}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {selectedActor ? getHandle(selectedActor) : ''}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[var(--radix-dropdown-menu-trigger-width)]"
          >
            {actors.map((actor) => {
              const isPendingDeletion = actor.deletionStatus === 'scheduled'
              const isDeleting = actor.deletionStatus === 'deleting'
              const reducedOpacity = isPendingDeletion || isDeleting
              const isCurrent = actor.id === currentActor.id

              return (
                <DropdownMenuItem
                  key={actor.id}
                  onClick={() => {
                    if (!isPendingDeletion && !isDeleting) {
                      setSelectedActorId(actor.id)
                    }
                  }}
                  disabled={
                    isSwitching ||
                    isSavingDefault ||
                    isPendingDeletion ||
                    isDeleting
                  }
                  className="flex items-center gap-3"
                >
                  <Avatar
                    className={`h-8 w-8 ${reducedOpacity ? 'opacity-60' : ''}`}
                  >
                    {actor.iconUrl && <AvatarImage src={actor.iconUrl} />}
                    <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 text-xs">
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
                  {isCurrent && !isPendingDeletion && !isDeleting && (
                    <span className="text-xs text-muted-foreground">
                      Current
                    </span>
                  )}
                  {actor.id === selectedActorId && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                  {isPendingDeletion && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCancelDeletion(actor.id)
                      }}
                      disabled={isCancelling}
                    >
                      Cancel
                    </Button>
                  )}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {message && (
          <p
            className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-destructive'}`}
          >
            {message.text}
          </p>
        )}

        <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
          <Button
            onClick={handleSwitchActor}
            disabled={
              isSwitching || !canSwitch || isSavingDefault || !hasMultipleActors
            }
            className="w-full sm:w-auto"
          >
            {isSwitching ? 'Switching...' : 'Switch to actor'}
          </Button>
          <Button
            onClick={handleSaveDefault}
            disabled={
              isSavingDefault ||
              !hasChanges ||
              isSwitching ||
              !hasMultipleActors
            }
            variant="outline"
            className="w-full sm:w-auto"
          >
            {isSavingDefault ? 'Saving...' : 'Set as default'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsDialogOpen(true)}
            disabled={isSwitching || isSavingDefault}
            className="w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add actor
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Select an actor from the dropdown. Use "Set as default" to set which
          actor is used on sign-in. Use "Switch to actor" to immediately change
          to the selected actor.
        </p>
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
