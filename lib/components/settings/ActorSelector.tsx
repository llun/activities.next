'use client'

import { FC } from 'react'

import { Label } from '@/lib/components/ui/label'

interface ActorSelectorProps {
  actors: Array<{
    id: string
    username: string
    domain: string
    name?: string | null
  }>
  selectedActorId: string
}

export const ActorSelector: FC<ActorSelectorProps> = ({
  actors,
  selectedActorId
}) => {
  if (actors.length <= 1) return null

  return (
    <div className="space-y-2">
      <Label htmlFor="actorSelect">Actor</Label>
      <select
        id="actorSelect"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        value={selectedActorId}
        onChange={(e) => {
          const actorId = encodeURIComponent(e.target.value)
          window.location.href = `/settings/notifications?actorId=${actorId}`
        }}
      >
        {actors.map((actorItem) => (
          <option key={actorItem.id} value={actorItem.id}>
            @{actorItem.username}@{actorItem.domain}
            {actorItem.name ? ` (${actorItem.name})` : ''}
          </option>
        ))}
      </select>
      <input type="hidden" name="actorId" value={selectedActorId} />
      <p className="text-[0.8rem] text-muted-foreground">
        These settings apply to the selected actor only
      </p>
    </div>
  )
}
