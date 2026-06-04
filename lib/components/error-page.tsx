import {
  AlertTriangle,
  Clock,
  Key,
  Lock,
  type LucideIcon,
  Search,
  Settings,
  Trash2
} from 'lucide-react'
import { FC } from 'react'

import { cn } from '@/lib/utils'

export type ErrorCode =
  | '404'
  | '403'
  | '401'
  | '410'
  | '429'
  | '500'
  | '503'
  | 'generic'

interface ErrorPageContent {
  /** Short label shown in the eyebrow pill above the hero. */
  reason: string
  /** Lucide icon paired with the reason in the eyebrow pill. */
  icon: LucideIcon
  /** Giant status code rendered as the hero. `null` falls back to a glyph. */
  num: string | null
  /** Heading shown below the hero. */
  title: string
  /** Supporting copy under the heading. */
  body: string
  /** Default monospace technical-detail line. Overridable per render. */
  meta: string
}

// Content for every 4xx / 5xx page plus the uncategorised fallback. Only 404,
// the route-segment error boundary, and the global error boundary are wired to
// real Next.js entry points today; the rest stay here so the design is ready
// the moment those codes need a dedicated HTML page.
const ERROR_PAGES: Record<ErrorCode, ErrorPageContent> = {
  '404': {
    reason: 'Not found',
    icon: Search,
    num: '404',
    title: "We couldn't find that page",
    body: "The page you're looking for doesn't exist, or it may have moved. Check the address, or head back to your timeline.",
    meta: '404 · not found'
  },
  '403': {
    reason: 'Forbidden',
    icon: Lock,
    num: '403',
    title: "You don't have access to this",
    body: 'This post or page is restricted. You may need to follow the account, or sign in with one that has access.',
    meta: '403 · access denied'
  },
  '401': {
    reason: 'Sign-in required',
    icon: Key,
    num: '401',
    title: 'Sign in to continue',
    body: 'This page is only available to signed-in accounts. Sign in to your instance to view it.',
    meta: '401 · unauthorized'
  },
  '410': {
    reason: 'Gone',
    icon: Trash2,
    num: '410',
    title: 'This post is no longer available',
    body: 'The author deleted this post, or it was removed from the server. Nothing was kept.',
    meta: '410 · gone'
  },
  '429': {
    reason: 'Rate limited',
    icon: Clock,
    num: '429',
    title: 'Too many requests',
    body: "You've hit the rate limit for this instance. Wait a moment, then try again.",
    meta: '429 · rate limited'
  },
  '500': {
    reason: 'Server error',
    icon: AlertTriangle,
    num: '500',
    title: 'Something went wrong on our end',
    body: "The server ran into an unexpected error. It's not you — try again in a moment.",
    meta: '500 · server error'
  },
  '503': {
    reason: 'Unavailable',
    icon: Settings,
    num: '503',
    title: 'Down for maintenance',
    body: "This instance is temporarily offline for maintenance. It'll be back shortly.",
    meta: '503 · scheduled maintenance'
  },
  generic: {
    reason: 'Error',
    icon: AlertTriangle,
    num: null,
    title: "Something isn't working",
    body: 'An unexpected error occurred. Try again, or head back to your timeline.',
    meta: 'unexpected error'
  }
}

interface ErrorPageProps {
  /** Which error page to render. Defaults to the 404 page. */
  code?: ErrorCode
  /**
   * Overrides the default monospace technical-detail line (e.g. to surface a
   * request digest from an error boundary). Falls back to the per-code default.
   */
  meta?: string
}

/**
 * Builds the monospace technical-detail line for a Next.js error boundary.
 * Prefers the production-safe `digest` (a hash that maps to a server log entry);
 * when there is no digest, surfaces the raw `error.message` only in development
 * so it never leaks internal details — or clutters the polished card — in
 * production. Returns `undefined` to fall back to the per-code default meta.
 */
export function errorBoundaryMeta(
  prefix: string,
  error?: (Error & { digest?: string }) | null
): string | undefined {
  // Defensive: a thrown non-Error value (or a missing one) must not crash the
  // boundary itself, so guard every property access and fall back to the
  // per-code default meta.
  if (error?.digest) return `${prefix} · ${error.digest}`
  if (process.env.NODE_ENV === 'development' && error?.message) {
    return `${prefix} · ${error.message}`
  }
  return undefined
}

/**
 * Centered hero error card from the design system's `web-errors` UI kit. The
 * hero is the giant status code in Activity orange (or an alert glyph for the
 * uncategorised fallback), wrapped in a reason pill → title → body → mono
 * technical line. The dual-tint backdrop comes from `body` in `globals.css`, so
 * this component intentionally stays backdrop-free and works in both the server
 * tree (`not-found`) and the client error boundaries (`error`/`global-error`).
 */
export const ErrorPage: FC<ErrorPageProps> = ({ code = '404', meta }) => {
  const content = ERROR_PAGES[code] ?? ERROR_PAGES.generic
  const ReasonIcon = content.icon
  const technicalDetail = meta ?? content.meta

  return (
    <div className="flex min-h-screen flex-col">
      {/* Neutral wrapper (not <main>): this component renders inside the
          server tree (not-found) and the client error boundaries, so it must
          not introduce a second <main> landmark when a parent layout already
          provides one. */}
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
        <div
          className={cn(
            'bg-card flex w-full flex-col items-center rounded-xl border px-[22px] py-7 text-center shadow-sm',
            'sm:max-w-[480px] sm:px-10 sm:py-11'
          )}
        >
          {/* Reason eyebrow pill */}
          <div className="bg-background text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
            <ReasonIcon className="size-[13px]" aria-hidden="true" />
            <span>{content.reason}</span>
          </div>

          {/* Hero: giant code, or a glyph for the uncategorised fallback */}
          {content.num ? (
            <div className="text-primary mt-3.5 text-[76px] font-semibold leading-none tracking-[-0.03em] sm:mt-[18px] sm:text-[112px]">
              {content.num}
            </div>
          ) : (
            <div className="text-primary mb-1 mt-4 sm:mt-[22px]">
              <AlertTriangle
                className="size-16 sm:size-[88px]"
                aria-hidden="true"
              />
            </div>
          )}

          {/* Title */}
          <h1 className="mt-3 text-xl font-semibold leading-[1.25] tracking-[-0.01em] text-pretty sm:mt-4 sm:text-2xl">
            {content.title}
          </h1>

          {/* Body */}
          <p className="text-muted-foreground mt-2.5 max-w-[380px] text-sm leading-[1.6] text-pretty sm:text-[15px]">
            {content.body}
          </p>

          {/* Technical detail */}
          <div className="mt-[22px] w-full border-t pt-4 sm:mt-7">
            <code className="text-muted-foreground font-mono text-xs">
              {technicalDetail}
            </code>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ErrorPage
