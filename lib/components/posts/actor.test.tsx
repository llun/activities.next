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

// A federated `preferredUsername` is a bare `z.string()` (see
// `lib/types/activitypub/actor.ts`) that `recordActorIfNeeded` writes verbatim,
// so a remote server can hand us one that normalises to nothing at all.
const degenerateActor: ActorProfile = {
  ...actor,
  id: 'https://remote.example/users/booster',
  username: '@',
  domain: 'remote.example',
  name: undefined
}

const namedDegenerateActor: ActorProfile = {
  ...degenerateActor,
  name: 'Test Actor'
}

describe('ActorInfo', () => {
  it.each([
    {
      description: 'links the actor mention for a usable username',
      props: { actor, actorId: 'https://llun.test/users/test' },
      href: '/@test@llun.test',
      text: 'Test Actor@test@llun.test'
    },
    {
      description: 'names an unnamed actor by its username',
      props: {
        actor: { ...actor, name: undefined },
        actorId: 'https://llun.test/users/test'
      },
      href: '/@test@llun.test',
      text: 'test@test@llun.test'
    },
    {
      description: 'keeps the actor mention when the actor id is opaque',
      props: {
        actor,
        actorId: 'https://llun.test/users/8b1f0d6c-6a1e-4f0a-9d3b-2c5e7f0a1b2c'
      },
      href: '/@test@llun.test',
      text: 'Test Actor@test@llun.test'
    },
    {
      description: 'falls back to the actor id for a degenerate username',
      props: {
        actor: degenerateActor,
        actorId: 'https://remote.example/users/booster'
      },
      href: '/@booster@remote.example',
      text: '@booster@remote.example'
    },
    {
      description: 'keeps the name but takes the mention from the actor id',
      props: {
        actor: namedDegenerateActor,
        actorId: 'https://remote.example/users/booster'
      },
      href: '/@booster@remote.example',
      text: 'Test Actor@remote.example'
    },
    {
      description:
        'reads the handle from the status url when the actor id is opaque too',
      props: {
        actor: degenerateActor,
        actorId:
          'https://remote.example/users/did:plc:5rkxs2rkfhyqvyzsxtlfvdhr',
        statusUrl: 'https://remote.example/@booster/109'
      },
      href: '/@booster@remote.example',
      text: '@booster@remote.example'
    },
    {
      description: 'renders the actor id handle when the actor is missing',
      props: { actorId: 'https://llun.test/users/test' },
      href: '/@test@llun.test',
      text: '@test@llun.test'
    }
  ])('$description', ({ props, href, text }) => {
    const { container } = render(<ActorInfo {...props} />)

    expect(screen.getByRole('link')).toHaveAttribute('href', href)
    expect(container.textContent).toBe(text)
  })

  it.each([
    {
      description: 'a degenerate username and an opaque actor id',
      props: {
        actor: degenerateActor,
        actorId: 'https://remote.example/users/did:plc:5rkxs2rkfhyqvyzsxtlfvdhr'
      },
      text: '@remote.example'
    },
    {
      description:
        'a named actor with a degenerate username and an opaque actor id',
      props: {
        actor: namedDegenerateActor,
        actorId: 'https://remote.example/users/did:plc:5rkxs2rkfhyqvyzsxtlfvdhr'
      },
      text: 'Test Actor'
    },
    {
      description: 'no actor and an opaque actor id',
      props: {
        actorId: 'https://remote.example/users/did:plc:5rkxs2rkfhyqvyzsxtlfvdhr'
      },
      text: '@remote.example'
    },
    {
      description: 'a degenerate username and no actor id to fall back on',
      props: { actor: degenerateActor, actorId: '' },
      text: '@'
    }
  ])('renders plain text and no link for $description', ({ props, text }) => {
    const { container } = render(<ActorInfo {...props} />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(container.textContent).toBe(text)
  })

  it('renders nothing without an actor or an actor id', () => {
    const { container } = render(<ActorInfo />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('ActorAvatar', () => {
  it.each([
    {
      description: 'the actor name',
      props: { actor, actorId: 'https://llun.test/users/test' },
      initials: 'TA'
    },
    {
      description: 'the actor username when it has no name',
      props: {
        actor: { ...actor, name: undefined },
        actorId: 'https://llun.test/users/test'
      },
      initials: 'T'
    },
    {
      description: 'the actor id handle when there is no actor',
      props: { actorId: 'https://llun.test/users/test' },
      initials: 'T'
    }
  ])(
    'builds the fallback initials from $description',
    ({ props, initials }) => {
      render(<ActorAvatar {...props} />)

      expect(screen.getByText(initials)).toBeInTheDocument()
    }
  )
})
