'use client'

import { X } from 'lucide-react'
import { FC } from 'react'

import type { DraftRecord } from '@/lib/client/drafts'
import { PostBox } from '@/lib/components/post-box/post-box'
import { StatusReplyBox } from '@/lib/components/posts/status-reply-box'
import { Button } from '@/lib/components/ui/button'
import { ActorProfile } from '@/lib/types/domain/actor'

interface Props {
  draft: DraftRecord
  host: string
  profile: ActorProfile
  isMediaUploadEnabled?: boolean
  /** The draft was sent, the composer was cancelled or Close was pressed. */
  onClose: () => void
}

/**
 * Opens a draft in the composer it was written in: `PostBox` for a post or a
 * quote, `StatusReplyBox` for a reply. The composer reads `draft` once and
 * keeps saving it; the list re-reads when it does.
 */
export const DraftEditor: FC<Props> = ({
  draft,
  host,
  profile,
  isMediaUploadEnabled,
  onClose
}) => (
  <div data-slot="draft-editor" className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-semibold">Editing draft</p>
      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
        <X aria-hidden />
        Close
      </Button>
    </div>
    {draft.composer === 'reply-box' && draft.replyTo ? (
      <StatusReplyBox
        key={draft.id}
        profile={profile}
        replyStatus={draft.replyTo}
        isMediaUploadEnabled={isMediaUploadEnabled}
        draft={draft}
        keepWhenEmpty
        onCancel={onClose}
        onPostCreated={onClose}
      />
    ) : (
      <PostBox
        key={draft.id}
        host={host}
        profile={profile}
        isMediaUploadEnabled={isMediaUploadEnabled}
        quotedStatus={draft.quoteOf}
        draft={draft}
        keepWhenEmpty
        onDiscardReply={onClose}
        onDiscardQuote={onClose}
        onDiscardEdit={onClose}
        onPostCreated={onClose}
        onPostUpdated={onClose}
      />
    )}
  </div>
)
