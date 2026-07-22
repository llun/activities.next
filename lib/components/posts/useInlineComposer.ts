'use client'

import { useCallback, useState } from 'react'

import {
  EditableStatus,
  Status,
  StatusNote,
  StatusPoll
} from '@/lib/types/domain/status'

export type StatusComposerMode = 'reply' | 'quote' | 'edit'

export interface ActiveStatusComposer {
  // The feed row the composer is anchored to, identified by the wrapper status
  // id (unique per row, unlike the unwrapped target below). Keying on this
  // stops a boost and its original — or two separate boosts of the same post —
  // from both opening a composer when they share one underlying status.
  anchorId: string
  // Always the resolved note/poll (Announce wrappers are unwrapped by the
  // caller before it reaches here), so quote/edit always have a concrete target.
  status: StatusNote | StatusPoll
  mode: StatusComposerMode
}

export interface InlineComposerControls {
  active: ActiveStatusComposer | null
  openReply: (status: Status, anchorId: string) => void
  openQuote: (status: Status, anchorId: string) => void
  openEdit: (status: EditableStatus, anchorId: string) => void
  close: () => void
}

/**
 * Tiny state holder shared by every surface that renders posts, so reply,
 * quote, and edit open the same inline composer under the target post instead
 * of each page wiring its own composer/state. Only one composer is open at a
 * time. Consumers (`Posts`, `StatusBox`) pass `openReply`/`openQuote`/`openEdit`
 * to the post action row (supplying the resolved target plus the row's own
 * `anchorId`) and render `InlineStatusComposer` under the row whose id matches
 * `active.anchorId`.
 */
export const useInlineComposer = (): InlineComposerControls => {
  const [active, setActive] = useState<ActiveStatusComposer | null>(null)

  // `onReply`/`onQuote` reach us with the already-resolved note/poll (the post
  // action row unwraps Announce before invoking them), so the cast is safe.
  const openReply = useCallback((status: Status, anchorId: string) => {
    setActive({
      anchorId,
      status: status as StatusNote | StatusPoll,
      mode: 'reply'
    })
  }, [])
  const openQuote = useCallback((status: Status, anchorId: string) => {
    setActive({
      anchorId,
      status: status as StatusNote | StatusPoll,
      mode: 'quote'
    })
  }, [])
  const openEdit = useCallback((status: EditableStatus, anchorId: string) => {
    setActive({ anchorId, status, mode: 'edit' })
  }, [])
  const close = useCallback(() => setActive(null), [])

  return { active, openReply, openQuote, openEdit, close }
}
