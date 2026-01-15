'use client'

import { Check, ChevronDown, Plus } from 'lucide-react'
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
}

interface ActorSwitcherProps {
  currentActor: ActorInfo
  actors: ActorInfo[]
}

export function ActorSwitcher({ currentActor, actors }: ActorSwitcherProps) {
  const router = useRouter()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)

  const getAvatarInitial = (username: string) => {
    if (!username) return '?'
    return username[0].toUpperCase()
  }

  const getHandle = (actor: ActorInfo) => `@${actor.username}@${actor.domain}`

  const handleSwitchActor = async (actorId: string) => {
    if (actorId === currentActor.id || isSwitching) return

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

  const handleActorCreated = () => {
    setIsDialogOpen(false)
    router.refresh()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-3 rounded-lg p-2 cursor-pointer hover:bg-muted transition-colors w-full text-left">
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
            {actors.length > 1 && (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[250px]">
          {actors.map((actor) => (
            <DropdownMenuItem
              key={actor.id}
              onClick={() => handleSwitchActor(actor.id)}
              disabled={isSwitching}
              className="flex items-center gap-3"
            >
              <Avatar className="h-8 w-8">
                {actor.iconUrl && <AvatarImage src={actor.iconUrl} />}
                <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 text-xs">
                  {getAvatarInitial(actor.username)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium truncate">
                  {actor.name || actor.username}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {getHandle(actor)}
                </p>
              </div>
              {actor.id === currentActor.id && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
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
