/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { EditHistoryButton } from './edit-history-button'

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const status = (
  overrides: Partial<StatusNote> = {},
  editText = 'the previous text'
): StatusNote => ({
  id: 'https://remote.example/users/bob/statuses/post-1',
  actorId: 'https://remote.example/users/bob',
  actor: {
    id: 'https://remote.example/users/bob',
    username: 'bob',
    domain: 'remote.example',
    name: 'Bob',
    followersUrl: 'https://remote.example/users/bob/followers',
    inboxUrl: 'https://remote.example/users/bob/inbox',
    sharedInboxUrl: 'https://remote.example/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: currentTime
  },
  to: [],
  cc: [],
  edits: [
    {
      text: editText,
      summary: null,
      createdAt: currentTime - 60_000
    }
  ],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://remote.example/@bob/post-1',
  text: 'the current text',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: [],
  ...overrides
})

const openHistory = (statusValue: StatusNote) => {
  const { container } = render(
    <EditHistoryButton
      host="llun.test"
      currentTime={currentTime}
      status={statusValue}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: /edit/i }))
  return container
}

describe('EditHistoryButton', () => {
  it('shows a previous revision', () => {
    openHistory(status({}, 'the previous text'))

    expect(screen.getByText('the previous text')).toBeInTheDocument()
  })

  it.each(['', ' \n\t'])(
    'explains an empty previous revision while showing its changes',
    (text) => {
      openHistory(
        status({
          edits: [
            {
              text,
              summary: null,
              createdAt: currentTime - 86_400_000,
              editedAt: currentTime - 3_600_000,
              changes: ['text-added', 'images-added'],
              changeDetailsUnavailable: false
            }
          ]
        })
      )

      expect(screen.getByText('Text added')).toBeInTheDocument()
      expect(screen.getByText('Images added')).toBeInTheDocument()
      expect(screen.getByText('No text in this version')).toBeInTheDocument()
      expect(screen.getByText('about 1 hour')).toBeInTheDocument()
      expect(screen.queryByText('1 day')).not.toBeInTheDocument()
    }
  )

  it('shows the unavailable fallback when no change can be established', () => {
    openHistory(
      status({
        edits: [
          {
            text: '',
            summary: null,
            createdAt: currentTime - 60_000,
            editedAt: currentTime - 60_000,
            changes: [],
            changeDetailsUnavailable: true
          }
        ]
      })
    )

    expect(screen.getByText('Status updated')).toBeInTheDocument()
    expect(
      screen.getByText('Change details are unavailable')
    ).toBeInTheDocument()
  })

  it('distinguishes unavailable historical text from a blank revision', () => {
    openHistory(
      status({
        edits: [
          {
            text: '',
            textAvailable: false,
            summary: null,
            createdAt: currentTime - 60_000,
            editedAt: currentTime - 60_000,
            changes: ['images-added'],
            changeDetailsUnavailable: true
          }
        ]
      })
    )

    expect(screen.getByText('Images added')).toBeInTheDocument()
    expect(screen.getByText('Previous text is unavailable')).toBeInTheDocument()
    expect(
      screen.queryByText('No text in this version')
    ).not.toBeInTheDocument()
  })

  it('keeps known change labels when other snapshot details are missing', () => {
    openHistory(
      status({
        edits: [
          {
            text: '',
            summary: null,
            createdAt: currentTime - 60_000,
            editedAt: currentTime - 60_000,
            changes: ['text-added'],
            changeDetailsUnavailable: true
          }
        ]
      })
    )

    expect(screen.getByText('Text added')).toBeInTheDocument()
    expect(
      screen.getByText('Some change details are unavailable')
    ).toBeInTheDocument()
  })

  // A revision is the status TEXT as it was, and for a remote status that is
  // raw HTML from the origin server — `status_history.data` snapshots
  // `status.text`, which is stored unsanitized and only cleaned at render.
  // This panel used to run its own two-line pipeline that sanitized neither
  // branch, so opening the edit history of a remote post put whatever that
  // server sent straight into the DOM. React drops a string `onerror` and
  // neutralises a `javascript:` href on its own, but it renders `<script>` and
  // `<iframe>` quite happily.
  describe('a hostile remote revision', () => {
    const hostile =
      '<p>before</p>' +
      '<script>window.pwned = 1</script>' +
      '<iframe src="https://evil.example/"></iframe>' +
      '<img src="x" onerror="window.pwned = 2">' +
      '<p>after</p>'

    it.each([
      { description: 'a script element', selector: 'script' },
      { description: 'an iframe', selector: 'iframe' },
      { description: 'a bare img', selector: 'img' }
    ])('does not render $description', ({ selector }) => {
      const container = openHistory(status({}, hostile))

      expect(container.querySelectorAll(selector)).toHaveLength(0)
    })

    it('still shows the readable text of the revision', () => {
      openHistory(status({}, hostile))

      expect(screen.getByText('before')).toBeInTheDocument()
      expect(screen.getByText('after')).toBeInTheDocument()
    })
  })

  // The panel renders a revision the same way the post itself is rendered, so
  // a local revision goes through the markdown renderer rather than being shown
  // as its own source.
  it('renders a local revision as markdown', () => {
    const container = openHistory(
      status({ isLocalActor: true }, 'a **bold** word')
    )

    expect(container.querySelector('strong')).toHaveTextContent('bold')
  })
})
