'use client'

import { FC } from 'react'

import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
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
    <Frame>
      <FormRow
        label="Actor"
        htmlFor="actorSelect"
        hint="These settings apply to the selected actor only"
      >
        {({ describedBy }) => (
          <>
            <Select
              id="actorSelect"
              aria-describedby={describedBy}
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
          </>
        )}
      </FormRow>
    </Frame>
  )
}
