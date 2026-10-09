import { FC } from 'react'

import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// Four message bubbles, alternating sides, in the shapes the loaded thread
// draws (the rounded corner with the tail corner squared). The bubble radius
// is intentional, so it stays rounded-2xl here as in `MessageBubble`.
const BUBBLES = [
  { own: false, size: 'h-12 w-48 md:w-64' },
  { own: true, size: 'h-16 w-56 md:w-72' },
  { own: false, size: 'h-20 w-60 md:w-80' },
  { own: true, size: 'h-10 w-36 md:w-48' }
] as const

/**
 * The thread's shape while its messages load, for the thread pane and for
 * `loading.tsx`: one polite "Loading messages" for assistive tech and bars
 * where the bubbles will be.
 */
export const MessageThreadSkeleton: FC = () => (
  <div
    role="status"
    data-slot="message-thread-skeleton"
    className="space-y-3 px-4 py-4 md:px-6"
  >
    <span className="sr-only">Loading messages</span>
    {BUBBLES.map(({ own, size }, index) => (
      <div
        key={index}
        className={own ? 'flex justify-end' : 'flex items-end gap-2'}
      >
        {own ? null : <SkeletonBar className="size-7 shrink-0 rounded-full" />}
        <div
          className={
            own
              ? 'flex max-w-[78%] flex-col items-end gap-1'
              : 'flex max-w-[78%] flex-col items-start gap-1'
          }
        >
          <SkeletonBar
            className={`${size} ${own ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md'}`}
          />
          <SkeletonBar className="h-2.5 w-12" />
        </div>
      </div>
    ))}
  </div>
)
