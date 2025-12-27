import { X } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { ActorInfo } from '@/lib/components/posts/actor'
import { Poll } from '@/lib/components/posts/poll'
import { EditableStatus, Status, StatusType } from '@/lib/models/status'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'


interface Props {
  host: string
  status?: Status
  onClose?: () => void
}

const getText = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return status.text
    case StatusType.enum.Announce:
      return status.originalStatus.text
    default:
      return ''
  }
}

const getTags = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return status.tags
    default:
      return []
  }
}

export const ReplyPreview: FC<Props> = ({ host, status, onClose }) => {
  if (!status) return null
  return (
    <section
      className="whitespace-pre-wrap flex flex-row justify-between bg-muted/50 rounded-lg mb-4 py-2 px-4"
    >
      <div>
        <ActorInfo actor={status.actor} actorId={status.actorId || ''} />
        {cleanClassName(
          (status as EditableStatus).isLocalActor
            ? convertMarkdownText(host)(getText(status))
            : convertEmojisToImages(getText(status), getTags(status))
        )}
        <Poll status={status} currentTime={new Date()} />
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onClose?.()}
        aria-label="Close"
      >
        <X className="size-4" />
      </Button>
    </section>
  )
}
