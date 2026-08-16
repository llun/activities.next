/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorProfile } from '@/lib/types/domain/actor'

import { AuthorizeInteractionCard } from './AuthorizeInteractionCard'

vi.mock('@/lib/components/follow-action/follow-action', () => ({
  FollowAction: ({ targetActorId }: { targetActorId: string }) => (
    <div data-testid="follow-action">{targetActorId}</div>
  )
}))

const actor = {
  id: 'https://remote.test/users/someone',
  username: 'someone',
  domain: 'remote.test',
  name: 'Someone Remote',
  iconUrl: 'https://remote.test/avatar.png'
} as ActorProfile

describe('AuthorizeInteractionCard', () => {
  it('shows the account and a follow action', () => {
    render(<AuthorizeInteractionCard actor={actor} isSelf={false} />)

    expect(screen.getByText('Someone Remote')).toBeInTheDocument()
    expect(screen.getByText('@someone@remote.test')).toBeInTheDocument()
    expect(screen.getByTestId('follow-action')).toHaveTextContent(
      'https://remote.test/users/someone'
    )
  })

  it('passes the raw activitypub id to the follow action', () => {
    render(<AuthorizeInteractionCard actor={actor} isSelf={false} />)

    // The client encodes ids itself; pre-encoding here would corrupt them.
    expect(screen.getByTestId('follow-action')).toHaveTextContent(
      'https://remote.test/users/someone'
    )
  })

  it('links to the profile page', () => {
    render(<AuthorizeInteractionCard actor={actor} isSelf={false} />)

    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute(
      'href',
      '/@someone@remote.test'
    )
  })

  it('hides the follow action for the viewer own account', () => {
    render(<AuthorizeInteractionCard actor={actor} isSelf />)

    expect(screen.queryByTestId('follow-action')).not.toBeInTheDocument()
    expect(screen.getByText('This is you')).toBeInTheDocument()
  })

  it('omits the profile link for the headless instance actor', () => {
    render(
      <AuthorizeInteractionCard
        actor={{ ...actor, type: 'Service' }}
        isSelf={false}
      />
    )

    expect(screen.queryByRole('link', { name: 'View profile' })).toBeNull()
    expect(screen.getByTestId('follow-action')).toBeInTheDocument()
  })

  it('falls back to the username when the account has no display name', () => {
    render(
      <AuthorizeInteractionCard
        actor={{ ...actor, name: undefined }}
        isSelf={false}
      />
    )

    expect(screen.getByText('@someone@remote.test')).toBeInTheDocument()
    expect(screen.queryByText('Someone Remote')).toBeNull()
  })
})
