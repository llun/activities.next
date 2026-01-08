import { formatDistance } from 'date-fns'
import { History } from 'lucide-react'
import { FC, useState } from 'react'

import { Status, StatusNote, StatusPoll } from '@/lib/models/status'
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

  if (status.edits.length === 0) return null

  return (
    <button
      className="relative flex items-center gap-1.5 rounded-full px-2 py-1 text-sm hover:bg-muted transition-colors"
      onClick={(e) => {
        e.stopPropagation()
        onShowEdits?.(status)
        setShowHistory((value) => !value)
      }}
      title={`${status.edits.length} edits`}
    >
      <History className="h-4 w-4" />
      {showHistory && (
        <div className="absolute bottom-full left-0 mb-2 w-[25rem] max-md:left-[-8rem] max-md:w-[18rem] z-20">
          <ul className="divide-y divide-border rounded-lg border bg-background shadow-lg">
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
    </button>
  )
}
