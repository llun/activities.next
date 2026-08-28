/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

import type { ActorProfile } from '@/lib/types/domain/actor'

import { ActorAvatar, ActorInfo } from './actor'

// next/link swallows `prefetch` instead of reflecting it in the DOM, so the
// only way to assert on it is to render the prop ourselves.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  )
}))

const actor: ActorProfile = {
  id: 'https://llun.test/users/test',
  username: 'test',
  domain: 'llun.test',
  name: 'Test Actor',
  followersUrl: 'https://llun.test/users/test/followers',
  inboxUrl: 'https://llun.test/users/test/inbox',
  sharedInboxUrl: 'https://llun.test/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 0
}

// A feed mounts hundreds of these links while scrolling, and `<Link>` prefetches
// on viewport entry. Prefetching an author profile fires a request against a
// fully dynamic route that also federates out for unpersisted remote actors, so
// every author link here must opt out.
describe('post author links', () => {
  it('does not prefetch the avatar link built from an actor profile', () => {
    render(<ActorAvatar actor={actor} />)

    expect(screen.getByRole('link')).toHaveAttribute('data-prefetch', 'false')
  })

  it('does not prefetch the avatar link built from an actor id', () => {
    render(<ActorAvatar actorId="https://llun.test/users/test" />)

    expect(screen.getByRole('link')).toHaveAttribute('data-prefetch', 'false')
  })

  it('does not prefetch the display-name link built from an actor profile', () => {
    render(<ActorInfo actor={actor} />)

    expect(screen.getByRole('link', { name: 'Test Actor' })).toHaveAttribute(
      'data-prefetch',
      'false'
    )
  })

  it('does not prefetch the handle link built from an actor id', () => {
    render(<ActorInfo actorId="https://llun.test/users/test" />)

    expect(screen.getByRole('link', { name: '@test' })).toHaveAttribute(
      'data-prefetch',
      'false'
    )
  })

  it('falls back the avatar link to the actor-id-derived href when the actor username normalises to empty', () => {
    render(
      <ActorAvatar
        actor={{ ...actor, username: '@' }}
        actorId="https://remote.example/users/booster"
      />
    )

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/@booster@remote.example'
    )
  })
})
