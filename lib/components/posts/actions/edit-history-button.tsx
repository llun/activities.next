import { formatDistance } from 'date-fns'
import { History, X } from 'lucide-react'
import { FC, useId, useRef, useState } from 'react'

import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

interface Props {
  host: string
  currentTime: number
  status: StatusNote | StatusPoll
  onShowEdits?: (status: Status) => void
}

export const EditHistoryButton: FC<Props> = ({
  host,
  currentTime,
  status,
  onShowEdits
}) => {
  const [showHistory, setShowHistory] = useState<boolean>(false)
  const editHistoryId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)

  if (status.edits.length === 0) return null

  const editCountLabel = `${status.edits.length} ${
    status.edits.length === 1 ? 'edit' : 'edits'
  }`
  const edits = [...status.edits].reverse()
  const closeHistory = () => {
    setShowHistory(false)
    triggerRef.current?.focus()
  }

  return (
    // Deliberately NOT `relative`: the panel below is anchored to the action
    // row (`Actions` owns the only `relative` ancestor) rather than to this
    // trigger, so it lines up with the post's own edges instead of with
    // wherever the trigger happens to land in the row.
    <div className="inline-flex">
      <button
        ref={triggerRef}
        className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation()
          onShowEdits?.(status)
          setShowHistory((value) => !value)
        }}
        title={editCountLabel}
        aria-label={`Show edit history, ${editCountLabel}`}
        aria-expanded={showHistory}
        aria-controls={showHistory ? editHistoryId : undefined}
      >
        <History className="h-4 w-4" />
      </button>
      {showHistory && (
        <div
          id={editHistoryId}
          role="region"
          aria-label="Edit history"
          // Anchored to the action row, not to the trigger: the row spans the
          // post exactly, so `right-0` puts this 25rem panel flush with the
          // post's right edge on every surface. Anchored to the trigger it
          // would start wherever the trigger sits — which moves with the
          // engagement counts beside it, now that the actions are packed at the
          // post's left edge — and a card that clips cuts off whatever hangs
          // outside it. Not all of them do: `Posts` and the status detail card
          // dropped `overflow-hidden` so this panel can escape *upward*, which
          // `bottom-full` needs and which staying inside the post's width
          // cannot buy. The fitness header card still clips, so the horizontal
          // fit here cannot lean on the ancestor either way. Below `md` the
          // panel is viewport-fixed instead, so the post's own width stops
          // mattering.
          className="absolute bottom-full right-0 z-20 mb-2 w-[25rem] rounded-lg border bg-background shadow-lg max-md:fixed max-md:inset-x-4 max-md:bottom-20 max-md:max-h-[calc(100vh-7rem)] max-md:w-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium text-foreground">
              Edit history
            </span>
            <button
              type="button"
              className="rounded-full p-1 transition-colors hover:bg-muted"
              aria-label="Close edit history"
              onClick={(e) => {
                e.stopPropagation()
                closeHistory()
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="max-h-80 divide-y divide-border overflow-auto max-md:max-h-[calc(100vh-10rem)]">
            {edits.map((edit, index) => {
              return (
                <li
                  key={`${edit.createdAt}-${index}`}
                  className="flex flex-col items-start p-3"
                >
                  <div className="self-end bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs">
                    {formatDistance(edit.createdAt, currentTime)}
                  </div>
                  <div className="mr-auto text-left mt-2 whitespace-normal overflow-auto max-h-40">
                    {cleanClassName(
                      status.isLocalActor
                        ? convertMarkdownText(host)(edit.text)
                        : convertEmojisToImages(edit.text, status.tags)
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
