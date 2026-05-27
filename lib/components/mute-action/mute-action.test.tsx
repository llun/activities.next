/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { mute, unmute } from '@/lib/client'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

import { MuteAction } from './mute-action'

const refresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh
  })
}))

jest.mock('@/lib/client', () => ({
  mute: jest.fn(),
  unmute: jest.fn()
}))

const relationship = (
  overrides: Partial<MastodonRelationship> = {}
): MastodonRelationship => ({
  id: 'target',
  following: false,
  showing_reblogs: false,
  notifying: false,
  followed_by: false,
  blocking: false,
  blocked_by: false,
  muting: false,
  muting_notifications: false,
  requested: false,
  requested_by: false,
  domain_blocking: false,
  endorsed: false,
  languages: ['en'],
  note: '',
  ...overrides
})

describe('MuteAction', () => {
  const muteMock = mute as jest.Mock
  const unmuteMock = unmute as jest.Mock

  beforeEach(() => {
    muteMock.mockReset()
    unmuteMock.mockReset()
    refresh.mockReset()
  })

  it('renders nothing when not logged in', () => {
    const { container } = render(
      <MuteAction
        targetActorId="https://example.test/users/target"
        isLoggedIn={false}
        initialRelationship={relationship()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there is no relationship yet', () => {
    const { container } = render(
      <MuteAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={null}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the confirm dialog when clicking Mute', async () => {
    render(
      <MuteAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    await screen.findByRole('dialog', { name: 'Mute account' })
  })

  it('mutes with notifications=true by default and switches to Unmute', async () => {
    muteMock.mockResolvedValue(relationship({ muting: true }))

    render(
      <MuteAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mute account' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mute' }))

    await waitFor(() => {
      expect(muteMock).toHaveBeenCalledWith({
        targetActorId: 'https://example.test/users/target',
        notifications: true
      })
    })
    expect(refresh).toHaveBeenCalled()
    await screen.findByRole('button', { name: 'Unmute' })
  })

  it('sends notifications=false when the checkbox is cleared', async () => {
    muteMock.mockResolvedValue(relationship({ muting: true }))

    render(
      <MuteAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mute account' })
    fireEvent.click(
      within(dialog).getByLabelText('Also hide notifications from this actor')
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mute' }))

    await waitFor(() => {
      expect(muteMock).toHaveBeenCalledWith({
        targetActorId: 'https://example.test/users/target',
        notifications: false
      })
    })
  })

  it('unmutes directly without showing a dialog', async () => {
    unmuteMock.mockResolvedValue(relationship({ muting: false }))

    render(
      <MuteAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship({ muting: true })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))

    await waitFor(() => {
      expect(unmuteMock).toHaveBeenCalledWith({
        targetActorId: 'https://example.test/users/target'
      })
    })
    expect(
      screen.queryByRole('dialog', { name: 'Mute account' })
    ).not.toBeInTheDocument()
    await screen.findByRole('button', { name: 'Mute' })
  })

  it('shows an error message when the mute call returns null', async () => {
    muteMock.mockResolvedValue(null)

    render(
      <MuteAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mute account' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mute' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to mute account. Please try again.'
    )
    expect(refresh).not.toHaveBeenCalled()
  })
})
