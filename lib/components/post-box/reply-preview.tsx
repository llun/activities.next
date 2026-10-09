import { X } from 'lucide-react'
import { FC } from 'react'

import { ActorInfo } from '@/lib/components/posts/actor'
import { ReplyTargetContent } from '@/lib/components/posts/reply-target-content'
import { Button } from '@/lib/components/ui/button'
import { Status } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface Props {
  host: string
  status?: Status
  onClose?: () => void
  className?: string
}

export const ReplyPreview: FC<Props> = ({
  host,
  status,
  onClose,
  className
}) => {
  if (!status) return null

  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border border-border/60 border-l-4 border-l-primary/20 bg-muted/20 px-3 py-2',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0 font-medium">Replying to</span>
            <div className="min-w-0 flex-1 text-sm text-foreground">
              <ActorInfo actor={status.actor} actorId={status.actorId || ''} />
            </div>
          </div>
          <ReplyTargetContent
            host={host}
            status={status}
            className="mt-1"
            fallback={
              <div className="mt-1 text-sm italic text-muted-foreground">
                No content preview
              </div>
            }
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onClose?.()}
          aria-label="Dismiss reply"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </Button>
      </div>
    </section>
  )
}
