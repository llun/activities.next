/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { Mastodon } from '@/lib/types/activitypub'
import { generatePublicId } from '@/lib/utils/publicId'

import { FollowNotification } from './FollowNotification'

// `@/lib/client` is deliberately NOT mocked: the regression this covers lives
// in the client helper's id handling, not in the component. Stubbing fetch
// instead lets the assertion read the request the button actually sends.
const buildAccount = (id: string): Mastodon.Account =>
  ({
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
    locked: false,
    fields: [],
    emojis: [],
    bot: false,
    group: false,
    discoverable: true,
    created_at: '2026-01-01T00:00:00.000Z',
    last_status_at: '2026-05-10',
    statuses_count: 1,
    followers_count: 0,
    following_count: 0
  }) as Mastodon.Account

describe('FollowNotification', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
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
