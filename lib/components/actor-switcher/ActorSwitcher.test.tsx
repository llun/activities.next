/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ActorSwitcher } from './ActorSwitcher'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    refresh: vi.fn()
  }))
}))

vi.mock('./AddActorDialog', () => ({
  AddActorDialog: () => null
}))

const alice = {
  id: 'actor-1',
  username: 'alice',
  domain: 'activities.local',
  name: 'Alice'
}
const bob = {
  id: 'actor-2',
  username: 'bob',
  domain: 'activities.local',
  name: 'Bob'
}

const profileHref = '/@alice@activities.local'

describe('ActorSwitcher', () => {
  describe('with a single actor', () => {
    it('renders the whole row as a link to the profile', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice]} />)

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', profileHref)
      expect(link).toHaveTextContent('Alice')
      expect(link).toHaveTextContent('@alice@activities.local')
    })

    it('does not render the actor-list dropdown trigger', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice]} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('does not render the chevron arrow', () => {
      const { container } = render(
        <ActorSwitcher currentActor={alice} actors={[alice]} />
      )

      expect(
        container.querySelector('.lucide-chevron-down')
      ).not.toBeInTheDocument()
    })
  })

  describe('with multiple actors', () => {
    it('links only the avatar icon to the profile', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      const iconLink = screen.getByRole('link', {
        name: "View Alice's profile"
      })
      expect(iconLink).toHaveAttribute('href', profileHref)
    })

    it('renders the name/handle/arrow as the dropdown trigger, not a link', () => {
      render(<ActorSwitcher currentActor={alice} actors={[alice, bob]} />)

      // The identity + chevron open the menu via a button trigger — they are
      // not part of the profile link, so clicking them switches actors rather
      // than navigating.
      const trigger = screen.getByRole('button')
      expect(trigger).toHaveTextContent('Alice')
      expect(trigger).toHaveTextContent('@alice@activities.local')
      expect(trigger.querySelector('.lucide-chevron-down')).toBeInTheDocument()

      // Only the avatar is a link; the identity text is inside the button.
      const profileLinks = screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href') === profileHref)
      expect(profileLinks).toHaveLength(1)
      expect(profileLinks[0]).not.toHaveTextContent('Alice')
    })
  })
})
