import { FC } from 'react'
import cn from 'classnames'
import parse from 'html-react-parser'
import { formatDistanceToNow } from 'date-fns'

import { Status } from '../models/status'
import { getHostnameFromId, getUsernameFromId } from '../models/actor'

interface Props {
  showActorId?: boolean
  statuses: Status[]
}

export const Posts: FC<Props> = ({ showActorId = false, statuses }) => {
  if (statuses.length === 0) return null

  return (
    <section className={cn('w-full', 'grid', 'grid-cols-1', 'mt-4')}>
      {statuses.map((status) => (
        <div key={status.id} className="block">
          {showActorId && (
            <div>
              <strong>
                @{getUsernameFromId(status.actorId)}@
                {getHostnameFromId(status.actorId)}
              </strong>
            </div>
          )}
          <div key={status.id} className={cn('d-flex')}>
            <div className={cn('flex-fill', 'me-1')}>
              {parse(status.text, {
                replace: (domNode: any) => {
                  if (domNode.attribs && domNode.name === 'a') {
                    domNode.attribs.target = '_blank'
                    return domNode
                  }

                  return domNode
                }
              })}
            </div>
            <div className="flex-shrink-0">
              {formatDistanceToNow(status.createdAt)}
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}
