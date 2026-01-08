import { X } from 'lucide-react'
import { FC } from 'react'

import { ActorInfo } from '@/lib/components/posts/actor'
import { Button } from '@/lib/components/ui/button'
import { Status } from '@/lib/models/status'
import { cn } from '@/lib/utils'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { processStatusText } from '@/lib/utils/text/processStatusText'

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

  const previewText = processStatusText(host, status)
  const parsedPreview = previewText ? cleanClassName(previewText) : null

  return (
    <section
      className={cn(
        'rounded-xl border border-border/60 border-l-4 border-l-primary/20 bg-muted/20 px-3 py-2',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">Replying to</span>
            <div className="text-sm text-foreground">
              <ActorInfo actor={status.actor} actorId={status.actorId || ''} />
            </div>
          </div>
          <div className="mt-1 text-sm text-muted-foreground leading-relaxed line-clamp-2 break-words [&_a]:text-sky-600 dark:[&_a]:text-sky-400 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-sky-700 dark:[&_a:hover]:text-sky-300 [&_p]:inline [&_p]:after:content-['_'] [&_br]:hidden">
            {parsedPreview ?? (
              <span className="italic">No content preview</span>
            )}
          </div>
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
