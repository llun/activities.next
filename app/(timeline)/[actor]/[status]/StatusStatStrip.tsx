import { Heart, type LucideIcon, Repeat2, Reply } from 'lucide-react'
import { FC } from 'react'

interface Props {
  boosts: number
  likes: number
  replies: number
}

interface Stat {
  key: string
  icon: LucideIcon
  count: number
  noun: string
}

// Read-only engagement summary shown on the focused status for logged-out
// visitors, who don't get the interactive action row. Mirrors the timeline
// status component's icon row (reply / boost / like) from the web-public
// design — same order and icon style as `ReadOnlyStats`, but it carries the
// real reply count, which timeline statuses don't hydrate.
export const StatusStatStrip: FC<Props> = ({ boosts, likes, replies }) => {
  const stats: Stat[] = [
    {
      key: 'replies',
      icon: Reply,
      count: replies,
      noun: replies === 1 ? 'reply' : 'replies'
    },
    {
      key: 'boosts',
      icon: Repeat2,
      count: boosts,
      noun: boosts === 1 ? 'boost' : 'boosts'
    },
    {
      key: 'likes',
      icon: Heart,
      count: likes,
      noun: likes === 1 ? 'like' : 'likes'
    }
  ]
  return (
    <div
      className="mt-3 flex items-center gap-5 border-t pt-3 text-sm text-muted-foreground sm:gap-6"
      aria-label="Engagement"
    >
      {stats.map(({ key, icon: Icon, count, noun }) => (
        <span
          key={key}
          className="inline-flex items-center gap-1.5"
          title={`${count} ${noun}`}
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className="tabular-nums">{count}</span>
          <span className="sr-only">{noun}</span>
        </span>
      ))}
    </div>
  )
}
