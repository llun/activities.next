'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'

interface ActorInfo {
  id: string
  username: string
  domain: string
  name?: string | null
  iconUrl?: string | null
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
      const response = await fetch('/api/v1/actors/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId })
      })

      if (response.ok) {
        router.push('/')
      }
    } finally {
      setIsLoading(null)
    }
  }

  return (
    <div className="space-y-2">
      {actors.map((actor) => (
        <button
          key={actor.id}
          onClick={() => handleSelectActor(actor.id)}
          disabled={isLoading !== null}
          className="w-full flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <Avatar className="h-12 w-12">
            {actor.iconUrl && <AvatarImage src={actor.iconUrl} />}
            <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {getAvatarInitial(actor.username)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 overflow-hidden text-left">
            <p className="text-base font-medium truncate">
              {actor.name || actor.username}
            </p>
            <p className="text-sm text-muted-foreground truncate">
              {getHandle(actor)}
            </p>
          </div>
          {isLoading === actor.id && (
            <span className="text-sm text-muted-foreground">Loading...</span>
          )}
        </button>
      ))}
    </div>
  )
}
