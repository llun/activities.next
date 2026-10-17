'use client'

import dynamic from 'next/dynamic'
import { ComponentProps, FC } from 'react'

import { createPreloadable } from '@/lib/components/lazy/createPreloadable'
import { LazyChunkBoundary } from '@/lib/components/posts/lazy-chunk-boundary'

const loadInlineStatusComposer = () =>
  import('@/lib/components/posts/inline-status-composer').then(
    (module) => module.InlineStatusComposer
  )

// Mounted only after a signed-in viewer clicks reply/quote/edit, so the
// composer (PostBox, emoji data, uploads, polls) stays out of the first-load
// bundle of anonymous pages. `ssr: false` is safe: it never renders on the
// server. Signed-in pages preload the chunk (see `useInlineComposer`) so opening
// the composer is usually instant; until it arrives nothing is drawn.
const DynamicInlineStatusComposer = dynamic(loadInlineStatusComposer, {
  ssr: false
})

// Renders synchronously once preloaded; see `createPreloadable`.
const { Component: LazyInlineStatusComposer, preload } = createPreloadable(
  loadInlineStatusComposer,
  DynamicInlineStatusComposer
)

export const InlineStatusComposer: FC<
  ComponentProps<typeof LazyInlineStatusComposer>
> = (props) => (
  <LazyChunkBoundary>
    <LazyInlineStatusComposer {...props} />
  </LazyChunkBoundary>
)

export const preloadInlineStatusComposer = () => {
  void preload()
}
