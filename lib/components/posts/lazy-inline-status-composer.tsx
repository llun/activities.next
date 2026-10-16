'use client'

import dynamic from 'next/dynamic'

const loadInlineStatusComposer = () =>
  import('@/lib/components/posts/inline-status-composer').then(
    (module) => module.InlineStatusComposer
  )

// Mounted only after a signed-in viewer clicks reply/quote/edit, so the
// composer (PostBox, emoji data, uploads, polls) stays out of the first-load
// bundle of anonymous pages. `ssr: false` is safe: it never renders on the
// server. Signed-in pages preload the chunk (see `useInlineComposer`) so opening
// the composer stays instant; `null` while loading avoids any layout shift.
export const InlineStatusComposer = dynamic(loadInlineStatusComposer, {
  ssr: false
})

export const preloadInlineStatusComposer = () => {
  loadInlineStatusComposer().catch(() => undefined)
}
