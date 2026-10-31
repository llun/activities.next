/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'

import type { Mastodon } from '@/lib/types/activitypub'
import { generatePublicId } from '@/lib/utils/publicId'

import { FollowNotification } from './FollowNotification'

const connection = vi.hoisted(() => ({ state: 'online' as string }))
vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({
    state: connection.state,
    nextProbeAt: null,
    probing: false
  })
}))

// `@/lib/client` is deliberately NOT mocked: the regression this covers lives
// in the client helper's id handling, not in the component. Stubbing fetch
// instead lets the assertion read the request the button actually sends.
const buildAccount = (id: string): Mastodon.Account => ({
  id,
  username: 'ride',
  acct: 'ride@llun.social',
  uri: 'https://llun.social/users/ride',
  url: 'https://llun.social/users/ride',
  display_name: 'Ride',
  note: '',
  avatar: '',
  avatar_static: '',
  header: '',
  header_static: '',
  avatar_description: '',
  header_description: '',
  locked: false,
  fields: [],
  emojis: [],
  bot: false,
  group: false,
  discoverable: true,
  indexable: true,
  hide_collections: false,
  noindex: false,
  roles: [],
  source: {
    note: '',
    fields: [],
    privacy: 'public',
    sensitive: false,
    language: 'en',
    attribution_domains: [],
    follow_requests_count: 0
  },
  created_at: '2026-01-01T00:00:00.000Z',
  last_status_at: '2026-05-10',
  statuses_count: 1,
  followers_count: 0,
  following_count: 0
})

describe('FollowNotification', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('follows back with the account id exactly as the server emitted it', async () => {
    // An Account `id` is a UUIDv7 publicId. Re-encoding it client-side turns it
    // into `<uuid>:`, which no accept-side resolver can decode — the button
    // then always fails.
    const publicId = generatePublicId()
    render(<FollowNotification account={buildAccount(publicId)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Follow back' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toEqual(
      `/api/v1/accounts/${publicId}/follow`
    )
    await screen.findByText('Following')
  })

  it('reports a failed follow back instead of showing Following', async () => {
    fetchMock.mockResolvedValue({ status: 404, ok: false })
    render(<FollowNotification account={buildAccount(generatePublicId())} />)

    fireEvent.click(screen.getByRole('button', { name: 'Follow back' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't follow back. Please try again."
    )
  })
})

const fetchMock = vi.fn()

describe('FollowNotification offline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connection.state = 'offline'
    // Radix Tooltip content measures itself; jsdom has no ResizeObserver.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    connection.state = 'online'
  })

  it('is aria-disabled but focusable, and a click makes no request', () => {
    render(<FollowNotification account={buildAccount(generatePublicId())} />)
    const button = screen.getByRole('button', { name: 'Follow back' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    button.focus()
    expect(button).toHaveFocus()

    fireEvent.click(button)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByText("You're offline", { selector: '[role=status]' })
    ).toBeInTheDocument()
  })

  it('shows the tooltip on focus', async () => {
    render(<FollowNotification account={buildAccount(generatePublicId())} />)
    act(() => screen.getByRole('button', { name: 'Follow back' }).focus())

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "You're offline"
    )
  })

  it('has no aria-disabled when unreachable', () => {
    connection.state = 'unreachable'
    render(<FollowNotification account={buildAccount(generatePublicId())} />)
    expect(
      screen.getByRole('button', { name: 'Follow back' })
    ).not.toHaveAttribute('aria-disabled')
  })
})
