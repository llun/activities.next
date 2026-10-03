'use client'

import { FC } from 'react'

import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'

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
      <Select
        id="actorSelect"
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
      </Select>
      <input type="hidden" name="actorId" value={selectedActorId} />
      <p className="text-[0.8rem] text-muted-foreground">
        These settings apply to the selected actor only
      </p>
    </div>
  )
}
