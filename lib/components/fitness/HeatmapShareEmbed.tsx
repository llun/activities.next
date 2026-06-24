'use client'

import {
  Check,
  Code,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Share2,
  X
} from 'lucide-react'
import { FC, useState } from 'react'

import { FitnessRouteHeatmapData } from '@/lib/client'
import { RouteHeatmapMap } from '@/lib/components/fitness/RouteHeatmapMap'
import { Button } from '@/lib/components/ui/button'
import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'
import { cn } from '@/lib/utils'

/** Embed/image sizes offered to the owner (mirrors the design kit). */
interface EmbedSize {
  id: 'sm' | 'md' | 'lg'
  label: string
  width: number
  height: number
}

const EMBED_SIZES: readonly EmbedSize[] = [
  { id: 'sm', label: 'Small', width: 400, height: 300 },
  { id: 'md', label: 'Medium', width: 600, height: 420 },
  { id: 'lg', label: 'Large', width: 800, height: 560 }
]

type ShareTab = 'embed' | 'image' | 'link'

const TABS: readonly { id: ShareTab; label: string; icon: typeof Code }[] = [
  { id: 'embed', label: 'Embed', icon: Code },
  { id: 'image', label: 'Image', icon: ImageIcon },
  { id: 'link', label: 'Link', icon: LinkIcon }
]

/**
 * Fully escapes a label for use inside an HTML attribute in a copyable snippet
 * (& first so an already-escaped entity isn't double-encoded), so a region name
 * containing &, <, >, or " copies into a valid snippet.
 */
const escapeAttr = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

interface CopyFieldProps {
  value: string
  /** Render as a multi-line monospace snippet (code) rather than a single line. */
  mono?: boolean
  /** Accessible label for the copy button (e.g. "Copy embed code"). */
  copyLabel: string
}

/**
 * A read-only, selectable value with a copy-to-clipboard button. Used for the
 * iframe/img snippets and the public link.
 */
const CopyField: FC<CopyFieldProps> = ({ value, mono, copyLabel }) => {
  const { copied, copy } = useCopyToClipboard()

  return (
    <div className="flex items-stretch gap-2">
      {mono ? (
        <textarea
          readOnly
          rows={3}
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 resize-none rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <input
          readOnly
          type="text"
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border bg-muted/40 px-2.5 py-1.5 text-[12px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      <Button
        type="button"
        size="sm"
        className="h-auto shrink-0 self-stretch px-3"
        onClick={() => copy(value)}
        aria-label={copyLabel}
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

interface ShareEnableCalloutProps {
  isSharing: boolean
  onShare: () => void
}

/** The not-yet-shared state: an opt-in to publish a public, read-only embed. */
const ShareEnableCallout: FC<ShareEnableCalloutProps> = ({
  isSharing,
  onShare
}) => (
  <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-5 text-sm sm:flex-row sm:items-center sm:justify-between">
    <p className="text-muted-foreground">
      Publish a public, read-only page and embeds of this heatmap. Anyone with
      the link can view it — you can stop sharing at any time.
    </p>
    <Button
      type="button"
      size="sm"
      className="shrink-0"
      disabled={isSharing}
      onClick={onShare}
    >
      {isSharing ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Share2 className="size-4" />
      )}
      Create public link
    </Button>
  </div>
)

export interface HeatmapShareEmbedProps {
  shareToken: string | null | undefined
  /** Origin used to build public/embed URLs (the actor's own domain). */
  embedOrigin: string
  /** Region label for the snippet title/alt; omit for the whole-world region. */
  regionLabel?: string
  isWorld: boolean
  /** Completed heatmap data, used for the in-panel live preview. */
  heatmap: FitnessRouteHeatmapData
  mapboxAccessToken?: string
  /** A share/unshare request is in flight for this region. */
  isSharing: boolean
  onShare: () => void
  onUnshare: () => void
  /** Open the panel by default (used in tests / deep links). */
  defaultOpen?: boolean
}

/**
 * Share & embed panel for a generated region heatmap. Collapsed by default to a
 * single button; opening it offers, once the heatmap is shared, three ways to
 * drop it into any other website — a live iframe embed, a static image, or a
 * link to its public page — each a copy-to-clipboard one-liner with a live
 * preview and a size selector.
 *
 * Unlike the design kit (which assumes every generated heatmap has a stable
 * public id), sharing here is an explicit, revocable opt-in: the public surface
 * is reachable only through an unguessable share token, so the panel gates the
 * tabs behind a "Create public link" action and offers "Stop sharing".
 */
export const HeatmapShareEmbed: FC<HeatmapShareEmbedProps> = ({
  shareToken,
  embedOrigin,
  regionLabel,
  isWorld,
  heatmap,
  mapboxAccessToken,
  isSharing,
  onShare,
  onUnshare,
  defaultOpen = false
}) => {
  const [open, setOpen] = useState(defaultOpen)
  const [tab, setTab] = useState<ShareTab>('embed')
  const [sizeId, setSizeId] = useState<EmbedSize['id']>('md')
  const size =
    EMBED_SIZES.find((entry) => entry.id === sizeId) ?? EMBED_SIZES[1]

  const isShared = Boolean(shareToken)
  const title = isWorld ? 'Whole world' : regionLabel?.trim() || 'Map area'
  const altText = `Route heatmap — ${title}`
  const altAttr = escapeAttr(altText)

  const linkUrl = shareToken ? `${embedOrigin}/u/heatmaps/${shareToken}` : ''
  const embedSrc = shareToken
    ? `${embedOrigin}/embed/heatmap/${shareToken}`
    : ''
  const imageUrl = shareToken
    ? `${embedOrigin}/embed/heatmap/${shareToken}/image?w=${size.width}&h=${size.height}`
    : ''

  const iframeSnippet = `<iframe src="${embedSrc}" width="${size.width}" height="${size.height}"\n  loading="lazy" style="border:0;border-radius:12px"\n  title="${altAttr}"></iframe>`
  const imageSnippet = `<a href="${linkUrl}">\n  <img src="${imageUrl}" width="${size.width}" height="${size.height}" alt="${altAttr}" />\n</a>`

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => setOpen(true)}
      >
        <Share2 className="size-4" />
        Share &amp; embed
      </Button>
    )
  }

  return (
    <section className="mt-4 rounded-xl border bg-card p-4 shadow-sm">
      {/* header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Share2 className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">Share &amp; embed</div>
            <div className="text-[11px] text-muted-foreground">
              Drop this heatmap into any other website — live embed, image, or a
              link.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close share & embed"
          className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>

      {!isShared ? (
        <ShareEnableCallout isSharing={isSharing} onShare={onShare} />
      ) : (
        <div className="space-y-3">
          {/* tabs */}
          <div
            role="tablist"
            aria-label="Share format"
            className="inline-flex rounded-lg border bg-muted/40 p-0.5"
          >
            {TABS.map((entry) => {
              const active = tab === entry.id
              const Icon = entry.icon
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  id={`share-tab-${entry.id}`}
                  aria-selected={active}
                  aria-controls={`share-panel-${entry.id}`}
                  onClick={() => setTab(entry.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="size-3.5" />
                  {entry.label}
                </button>
              )
            })}
          </div>

          {/* size selector — only relevant to embed/image */}
          {tab !== 'link' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Size
              </span>
              <div className="inline-flex items-center rounded-md border p-0.5">
                {EMBED_SIZES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={sizeId === entry.id}
                    onClick={() => setSizeId(entry.id)}
                    className={cn(
                      'rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
                      sizeId === entry.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
                <span className="self-center px-2 text-[11px] text-muted-foreground/80 tabular-nums">
                  {size.width}×{size.height}
                </span>
              </div>
            </div>
          )}

          {/* body */}
          {tab === 'embed' && (
            <div
              role="tabpanel"
              id="share-panel-embed"
              aria-labelledby="share-tab-embed"
              className="space-y-2"
            >
              <CopyField
                value={iframeSnippet}
                mono
                copyLabel="Copy embed code"
              />
              <div
                className="overflow-hidden rounded-lg border"
                style={{ maxWidth: size.width }}
              >
                <RouteHeatmapMap
                  heatmap={heatmap}
                  mapboxAccessToken={mapboxAccessToken}
                  heightClassName="h-[280px]"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                A live, pannable map — it stays in sync with the latest
                generated version.
              </p>
            </div>
          )}

          {tab === 'image' && (
            <div
              role="tabpanel"
              id="share-panel-image"
              aria-labelledby="share-tab-image"
              className="space-y-2"
            >
              <CopyField
                value={imageSnippet}
                mono
                copyLabel="Copy image code"
              />
              <p className="text-[11px] text-muted-foreground">
                A static <code className="font-mono">.png</code> snapshot — best
                for emails, READMEs, and places that block iframes.
              </p>
            </div>
          )}

          {tab === 'link' && (
            <div
              role="tabpanel"
              id="share-panel-link"
              aria-labelledby="share-tab-link"
              className="space-y-2"
            >
              <CopyField value={linkUrl} copyLabel="Copy public link" />
              <a
                href={linkUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" /> Open the public page
              </a>
              <p className="text-[11px] text-muted-foreground">
                Anyone with the link can view this heatmap on its own public
                page.
              </p>
            </div>
          )}

          {/* stop sharing */}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-[11px] text-muted-foreground">
              This heatmap is public.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={isSharing}
              onClick={onUnshare}
            >
              {isSharing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              Stop sharing
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
