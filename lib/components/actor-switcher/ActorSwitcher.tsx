'use client'

import { Check, ChevronDown, Clock, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'

import { AddActorDialog } from './AddActorDialog'

export interface ActorInfo {
  id: string
  username: string
  domain: string
  name?: string | null
  iconUrl?: string | null
  deletionStatus?: string | null
  deletionScheduledAt?: number | null
}

interface ActorSwitcherProps {
  currentActor: ActorInfo
  actors: ActorInfo[]
}

export function ActorSwitcher({ currentActor, actors }: ActorSwitcherProps) {
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
        // Use hard navigation to ensure full page reload with new actor
        window.location.reload()
      }
    } finally {
      setIsSwitching(false)
    }
  }

  const handleCancelDeletion = async (actorId: string, e: React.MouseEvent) => {
    e.stopPropagation()
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
    // Use hard navigation to ensure full page reload with new actor
    window.location.reload()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className="flex items-center gap-3 rounded-lg p-2 cursor-pointer hover:bg-muted transition-colors w-full">
            <Link
              href={`/@${currentActor.username}@${currentActor.domain}`}
              className="flex items-center gap-3 flex-1 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar className="h-10 w-10">
                {currentActor.iconUrl && (
                  <AvatarImage src={currentActor.iconUrl} />
                )}
                <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  {getAvatarInitial(currentActor.username)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium truncate">
                  {currentActor.name || currentActor.username}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {getHandle(currentActor)}
                </p>
              </div>
            </Link>
            {actors.length > 1 && (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[280px]">
          {actors.map((actor) => {
            const isPendingDeletion = actor.deletionStatus === 'scheduled'
            const isDeleting = actor.deletionStatus === 'deleting'
            // Keep the row clickable for cancellation when deletion is scheduled.
            const isDisabled = isSwitching || isDeleting

            const reducedOpacity = isPendingDeletion || isDeleting

            return (
              <DropdownMenuItem
                key={actor.id}
                onClick={() => handleSwitchActor(actor.id)}
                disabled={isDisabled}
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
                {actor.id === currentActor.id &&
                  !isPendingDeletion &&
                  !isDeleting && <Check className="h-4 w-4 text-primary" />}
                {isPendingDeletion && (
                  <button
                    onClick={(e) => handleCancelDeletion(actor.id, e)}
                    disabled={isCancelling}
                    className="text-xs text-primary hover:text-primary/80 px-2 py-1 rounded hover:bg-muted cursor-pointer"
                    title="Cancel deletion"
                  >
                    Cancel
                  </button>
                )}
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add another actor
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddActorDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        domain={currentActor.domain}
        onSuccess={handleActorCreated}
      />
    </>
  )
}
