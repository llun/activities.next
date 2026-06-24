import {
  Activity,
  Calendar,
  ChevronRight,
  Eye,
  Flame,
  Globe,
  Maximize,
  Route
} from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { RouteHeatmapMap } from '@/lib/components/fitness/RouteHeatmapMap'
import { Logo } from '@/lib/components/layout/logo'
import { Button } from '@/lib/components/ui/button'

import { CopyLinkButton } from './CopyLinkButton'
import { SharedHeatmapView } from './sharedHeatmapView'

export interface SharedHeatmapPageProps {
  view: SharedHeatmapView
  mapboxAccessToken?: string
  /** Whether the instance accepts new sign-ups (gates the Create-account CTAs). */
  signupOpen: boolean
  signinUrl: string
  signupUrl: string
}

interface StatTileProps {
  icon: FC<{ className?: string }>
  label: string
  value: string
}

const StatTile: FC<StatTileProps> = ({ icon: Icon, label, value }) => (
  <div className="rounded-xl border bg-card/80 px-4 py-3 shadow-sm">
    <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      <Icon className="size-3.5" />
      {label}
    </div>
    <div className="mt-1 truncate text-lg font-semibold leading-tight tracking-tight tabular-nums">
      {value}
    </div>
  </div>
)

/**
 * The public, read-only destination for a shared route heatmap (at
 * `/u/heatmaps/<token>`). No account required: logged-out chrome, the live heat
 * map, a read-only stats strip, an owner line, and a join CTA. There are no
 * edit / generate / share-panel controls — those live in the in-app region page.
 */
export const SharedHeatmapPage: FC<SharedHeatmapPageProps> = ({
  view,
  mapboxAccessToken,
  signupOpen,
  signinUrl,
  signupUrl
}) => {
  const { title, isWorld, bboxLabel, owner, generatedLabel, publicUrl, stats } =
    view

  return (
    <div
      className="min-h-dvh"
      style={{
        backgroundImage:
          'radial-gradient(1200px 600px at 10% -10%, hsl(24 95% 95% / 0.9), transparent 60%),' +
          'radial-gradient(900px 600px at 90% -10%, hsl(200 80% 94% / 0.8), transparent 55%)',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed'
      }}
    >
      {/* public top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[840px] items-center gap-3 px-4 sm:px-6">
          <Logo size="md" />
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={signinUrl}>Sign in</Link>
            </Button>
            {signupOpen && (
              <Button asChild size="sm">
                <Link href={signupUrl}>Create account</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[840px] px-4 py-6 sm:px-6 sm:py-8">
        {/* public, read-only context pill */}
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <Eye className="size-3" /> Public heatmap · anyone with the link can
          view
        </div>

        {/* header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              {isWorld ? (
                <Globe className="size-6" />
              ) : (
                <Maximize className="size-6" />
              )}
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="flex size-5 items-center justify-center rounded-full bg-muted-foreground text-[10px] font-semibold text-background">
                    {owner.initials}
                  </span>
                  <span className="font-medium text-foreground">
                    {owner.handle}
                  </span>
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span>Generated {generatedLabel}</span>
              </div>
              {bboxLabel && (
                <div className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                  {bboxLabel}
                </div>
              )}
            </div>
          </div>
          <CopyLinkButton url={publicUrl} />
        </div>

        {/* the heat map */}
        <div className="mt-5">
          <div className="overflow-hidden rounded-xl border">
            <RouteHeatmapMap
              heatmap={view.heatmap}
              mapboxAccessToken={mapboxAccessToken}
              heightClassName="h-[440px]"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A live, pannable density map — brighter areas are ridden or run more
            often. Drag to explore.
          </p>
        </div>

        {/* read-only stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile icon={Route} label="Routes" value={stats.routes} />
          <StatTile icon={Activity} label="Activity" value={stats.activity} />
          <StatTile icon={Calendar} label="Period" value={stats.period} />
        </div>

        {/* join CTA */}
        <div className="mt-6 overflow-hidden rounded-2xl border shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-primary/5 p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Flame className="size-5" />
              </span>
              <div>
                <div className="text-sm font-semibold">
                  Make a heatmap from your own routes
                </div>
                <p className="mt-0.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                  Upload your activities to Activities and aggregate years of
                  rides and runs into a density map like this one.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {signupOpen && (
                <Button asChild size="sm">
                  <Link href={signupUrl}>Create account</Link>
                </Button>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href={signinUrl}>
                  Sign in <ChevronRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </main>

      {/* footer */}
      <footer className="mx-auto max-w-[840px] px-4 pb-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-sm text-muted-foreground">
          <span>
            <strong className="font-semibold text-foreground">
              Activities
            </strong>{' '}
            — a self-hosted social + fitness server on the Fediverse.
          </span>
        </div>
      </footer>
    </div>
  )
}
