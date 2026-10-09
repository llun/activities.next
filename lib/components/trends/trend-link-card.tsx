import { safeExternalHref } from '@/lib/components/trends/safeHref'
import type { PreviewCard } from '@/lib/types/mastodon/previewCard'

interface TrendLinkCardProps {
  link: PreviewCard
}

// Always derive the bare hostname from the URL so it can stand on its own and,
// when a distinct `provider_name` is present, pair with it as "publisher · domain".
const getDomain = (card: PreviewCard) => {
  try {
    return new URL(card.url).hostname.replace(/^www\./, '')
  } catch {
    return card.provider_name || card.url
  }
}

// One trending news link — preview image, "publisher · domain", a 2-line title
// and description. It is one row of a `FramedList`: the caller wraps it in a
// `FramedListItem` without padding (`className="p-0"`).
export const TrendLinkCard = ({ link }: TrendLinkCardProps) => {
  const domain = getDomain(link)

  return (
    <a
      href={safeExternalHref(link.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-4 px-4 py-3 transition-colors hover:bg-muted focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:ring-inset outline-none"
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
          <div className="line-clamp-2 text-sm leading-snug text-muted-foreground">
            {link.description}
          </div>
        )}
      </div>
    </a>
  )
}
