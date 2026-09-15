'use client'

import { useRef } from 'react'

import { Actor, Status } from '@/lib/types/database'
import { ActorProfile } from '@/lib/types/domain/actor'

import { Post } from './post'

export interface BoostCarouselProps {
  statuses: Status[]
  currentActor?: ActorProfile | Actor
  onReply?: (status: Status) => void
  onBoost?: (status: Status) => void
  onLike?: (status: Status) => void
  onBookmark?: (status: Status) => void
  onDelete?: (status: Status) => void
}

export function BoostCarousel({
  statuses,
  currentActor,
  onReply,
  onBoost,
  onLike,
  onBookmark,
  onDelete
}: BoostCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  if (!statuses || statuses.length === 0) return null

  const handleScroll = (offset: number) => {
    scrollRef.current?.scrollBy({ left: offset, behavior: 'smooth' })
  }

  return (
    <div className="relative my-4 max-w-full overflow-hidden rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/50">
        <span className="text-sm font-semibold text-muted-foreground">
          Boosts ({statuses.length})
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous boosts"
            onClick={() => handleScroll(-300)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Next boosts"
            onClick={() => handleScroll(300)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none"
          >
            →
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        role="region"
        aria-label="Boosts carousel"
        tabIndex={0}
        className="flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory py-1 focus:outline-none"
      >
        {statuses.map((status) => (
          <div
            key={status.id}
            className="snap-start shrink-0 w-[280px] sm:w-[320px] rounded-lg border border-border bg-card p-3 shadow-xs"
          >
            <Post
              status={status}
              currentActor={currentActor}
              onReply={onReply}
              onBoost={onBoost}
              onLike={onLike}
              onBookmark={onBookmark}
              onDelete={onDelete}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
