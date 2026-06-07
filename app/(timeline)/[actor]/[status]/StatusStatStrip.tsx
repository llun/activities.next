import { FC } from 'react'

interface Props {
  boosts: number
  likes: number
  replies: number
}

interface Stat {
  count: number
  label: string
}

// Read-only engagement summary shown on the focused status for logged-out
// visitors, who don't get the interactive action row. Mirrors the stat strip in
// the web-public design (Boosts / Likes / Replies).
export const StatusStatStrip: FC<Props> = ({ boosts, likes, replies }) => {
  const stats: Stat[] = [
    { count: boosts, label: 'Boosts' },
    { count: likes, label: 'Likes' },
    { count: replies, label: 'Replies' }
  ]
  return (
    <div className="mt-3 flex gap-5 border-t pt-3 text-sm">
      {stats.map(({ count, label }) => (
        <span key={label} className="flex items-baseline gap-1">
          <strong className="font-semibold tabular-nums">{count}</strong>
          <span className="text-muted-foreground">{label}</span>
        </span>
      ))}
    </div>
  )
}
