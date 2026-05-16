import { formatDistance } from 'date-fns'
import { History, X } from 'lucide-react'
import { FC, useId, useState } from 'react'

import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { convertEmojisToImages } from '@/lib/utils/text/convertEmojisToImages'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

interface Props {
  host: string
  status: StatusNote | StatusPoll
  onShowEdits?: (status: Status) => void
}

export const EditHistoryButton: FC<Props> = ({ host, status, onShowEdits }) => {
  const [showHistory, setShowHistory] = useState<boolean>(false)
  const editHistoryId = useId()

  if (status.edits.length === 0) return null

  const editCountLabel = `${status.edits.length} ${
    status.edits.length === 1 ? 'edit' : 'edits'
  }`

  return (
    <div className="relative inline-flex">
      <button
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-sm hover:bg-muted transition-colors"
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
          role="dialog"
          aria-label="Edit history"
          className="absolute bottom-full left-0 z-20 mb-2 w-[25rem] rounded-lg border bg-background shadow-lg max-md:fixed max-md:inset-x-4 max-md:bottom-20 max-md:max-h-[calc(100vh-7rem)] max-md:w-auto"
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
                setShowHistory(false)
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="max-h-80 divide-y divide-border overflow-auto max-md:max-h-[calc(100vh-10rem)]">
            {status.edits.reverse().map((edit, index) => {
              return (
                <li
                  key={edit.createdAt + index}
                  className="flex flex-col items-start p-3"
                >
                  <div className="self-end bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs">
                    {formatDistance(edit.createdAt, Date.now())}
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
