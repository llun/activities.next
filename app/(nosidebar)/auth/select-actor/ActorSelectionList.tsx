'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { switchActor } from '@/lib/client'
import { ActorDisplayName } from '@/lib/components/actors/ActorDisplayName'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'

interface ActorInfo {
  id: string
  username: string
  domain: string
  name?: string | null
  iconUrl?: string | null
  tags?: { type: string; name: string; value: string }[] | null
}

interface ActorSelectionListProps {
  actors: ActorInfo[]
}

export function ActorSelectionList({ actors }: ActorSelectionListProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState<string | null>(null)

  const getAvatarInitial = (username: string) => {
    if (!username) return '?'
    return username[0].toUpperCase()
  }

  const getHandle = (actor: ActorInfo) => `@${actor.username}@${actor.domain}`

  const handleSelectActor = async (actorId: string) => {
    if (isLoading) return

    setIsLoading(actorId)
    try {
      const ok = await switchActor({ actorId })

      if (ok) {
        router.push('/')
      }
    } finally {
      setIsLoading(null)
    }
  }

  return (
    <div className="space-y-2">
      {/* Outside the buttons: a button's children are presentational, so a
          status inside one would only be folded into its name. */}
      <p role="status" className="sr-only">
        {isLoading !== null ? 'Switching account' : ''}
      </p>
      {actors.map((actor) => (
        <button
          key={actor.id}
          onClick={() => handleSelectActor(actor.id)}
          disabled={isLoading !== null}
          className="w-full flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <Avatar className="h-12 w-12">
            {actor.iconUrl && <AvatarImage src={actor.iconUrl} />}
            <AvatarFallback className="bg-(--skeleton) font-semibold text-muted-foreground dark:bg-input">
              {getAvatarInitial(actor.username)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 overflow-hidden text-left">
            <p className="text-base font-medium truncate">
              <ActorDisplayName
                name={actor.name || actor.username}
                tags={actor.tags}
              />
            </p>
            <p className="text-sm text-muted-foreground truncate">
              {getHandle(actor)}
            </p>
          </div>
          {isLoading === actor.id && <SkeletonBar className="h-4 w-12" />}
        </button>
      ))}
    </div>
  )
}
