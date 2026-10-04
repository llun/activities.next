/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'
import { withTimeZone } from '@/lib/testing/withTimeZone'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { MessageBubble } from './MessageBubble'

// 02:30 UTC on 17 May is 22:30 on 16 May in New York (EDT, UTC-4).
const SENT_AT = Date.parse('2026-05-17T02:30:00.000Z')

const status: StatusNote = {
  id: 'status-1',
  actorId: 'https://example.com/users/ada',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: SENT_AT,
  updatedAt: SENT_AT,
  type: StatusType.enum.Note,
  url: 'https://example.com/statuses/status-1',
  text: '<p>See you tonight</p>',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
}

describe('MessageBubble', () => {
  it("hydrates the server's UTC send time without a mismatch, then shows the reader's own", async () => {
    const element = (
      <MessageBubble
        host="example.com"
        status={status}
        isOwn={false}
        onShowAttachment={vi.fn()}
      />
    )

    await withTimeZone('America/New_York', async () => {
      const { serverHtml, container, onRecoverableError, unmount } =
        await hydrateServerHtml(element)

      try {
        expect(serverHtml).toContain('2:30 AM')
        expect(onRecoverableError).not.toHaveBeenCalled()
        // In the reader's own locale, which the suite does not pin.
        expect(container.textContent).toContain(
          new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'America/New_York'
          }).format(SENT_AT)
        )
        expect(container).not.toHaveTextContent('2:30 AM')
      } finally {
        unmount()
      }
    })
  })
})
