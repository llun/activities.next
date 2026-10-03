import type { CSSProperties } from 'react'

// Shared geometry for the page chrome. Dependency-free and without a
// `'use client'` directive on purpose: server-rendered components read these
// values too — `BackLink` when a server page renders it, the followers/following
// loading skeleton — and a value read out of a client module comes back empty
// on the server (see **Server/Client Module Boundary** in docs/architecture.md).
// Mirrors `lib/components/posts/feedLayout.ts`.

// Break out of the content column (`max-w-content`) so the chrome spans the
// full area to the right of the fixed sidebar. The inner row stays centered at
// `max-w-content` so the title aligns above the content column.
//
// 50% here is half of the parent's content-box width (Tailwind's `px-4` is part
// of the box, not the content area). The horizontal pair therefore collapses to
// `(parent content width) + 2*M = 100vw - sidebar-w`, which is exactly the
// available area beside the fixed sidebar at any viewport size — and, below
// `md` where there is no sidebar, the full viewport width.
export const breakoutStyle: CSSProperties = {
  marginLeft: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)',
  marginRight: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)'
}

// The mobile "Compact B" bar: one 56px row — 55px of content box plus the 1px
// bottom border (`box-content`, so the top safe-area padding is added on top of
// it rather than taken out of it) — holding the
// menu button and a single truncating title. Sticky over the page, on the
// translucent Surface Chrome token, and gone from `md` up, where the sidebar
// and the desktop `PageHeader` take over.
export const MOBILE_COMPACT_HEADER_CLASS =
  'sticky top-0 z-30 box-content flex h-[55px] items-center gap-2 border-b bg-surface-chrome pl-2 pr-4 safe-area-pt backdrop-blur md:hidden'

// The labelled Back row that replaces the back arrow the old bars carried: a
// 44px-tall target in the first row of the content. From `md` up a `BackLink`
// with `iconOnlyFrom="md"` collapses to the icon it always was.
export const MOBILE_BACK_ROW_CLASS =
  'max-md:-ml-1 max-md:min-h-11 max-md:gap-2 max-md:px-1 max-md:text-sm max-md:font-medium'
