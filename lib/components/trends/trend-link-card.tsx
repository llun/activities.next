import type { PreviewCard } from '@/lib/types/mastodon/previewCard'

interface TrendLinkCardProps {
  link: PreviewCard
}

const getDomain = (card: PreviewCard) => {
  if (card.provider_name) return card.provider_name
  try {
    return new URL(card.url).hostname.replace(/^www\./, '')
  } catch {
    return card.url
  }
}

// One trending news link — preview image, "publisher · domain", a 2-line title
// and description. Reuses the existing link-card anatomy.
export const TrendLinkCard = ({ link }: TrendLinkCardProps) => {
  const domain = getDomain(link)

  return (
    <a
      href={link.url}
      className="flex gap-4 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted"
    >
      {link.image && (
        <img
          src={link.image}
          alt=""
          className="size-[88px] shrink-0 rounded-lg object-cover"
        />
      )}
      <div className="min-w-0 space-y-0.5">
        <div className="text-xs text-muted-foreground">
          {link.provider_name && link.provider_name !== domain
            ? `${link.provider_name} · ${domain}`
            : domain}
        </div>
        <div className="line-clamp-2 text-sm font-semibold leading-snug">
          {link.title}
        </div>
        {link.description && (
          <div className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {link.description}
          </div>
        )}
      </div>
    </a>
  )
}
