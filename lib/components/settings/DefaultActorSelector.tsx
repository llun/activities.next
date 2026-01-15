'use client'

import { useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'

interface ActorInfo {
  id: string
  username: string
  domain: string
  name?: string | null
  iconUrl?: string | null
}

interface DefaultActorSelectorProps {
  actors: ActorInfo[]
  currentDefault: string | null
}

export function DefaultActorSelector({
  actors,
  currentDefault
}: DefaultActorSelectorProps) {
  const [selectedActorId, setSelectedActorId] = useState<string>(
    currentDefault || actors[0]?.id || ''
  )
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const getAvatarInitial = (username: string) => {
    if (!username) return '?'
    return username[0].toUpperCase()
  }

  const getHandle = (actor: ActorInfo) => `@${actor.username}@${actor.domain}`

  const handleSave = async () => {
    if (!selectedActorId) return

    setIsSaving(true)
    setMessage(null)

    try {
      const response = await fetch('/api/v1/actors/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: selectedActorId })
      })

      if (response.ok) {
        setMessage({ type: 'success', text: 'Default actor updated' })
      } else {
        setMessage({ type: 'error', text: 'Failed to update default actor' })
      }
    } catch {
      setMessage({ type: 'error', text: 'An error occurred' })
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges = selectedActorId !== currentDefault

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {actors.map((actor) => (
          <label
            key={actor.id}
            className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted transition-colors"
          >
            <input
              type="radio"
              name="defaultActor"
              value={actor.id}
              checked={selectedActorId === actor.id}
              onChange={(e) => setSelectedActorId(e.target.value)}
              className="h-4 w-4"
            />
            <Avatar className="h-10 w-10">
              {actor.iconUrl && <AvatarImage src={actor.iconUrl} />}
              <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
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
          </label>
        ))}
      </div>

      {message && (
        <p
          className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-destructive'}`}
        >
          {message.text}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
          {isSaving ? 'Saving...' : 'Save default'}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        The default actor will be used when you sign in.
      </p>
    </div>
  )
}
