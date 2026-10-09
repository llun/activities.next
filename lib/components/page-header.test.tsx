/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { type AnchorHTMLAttributes, type ReactNode } from 'react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import {
  PageHeader,
  PageHeaderSectionProvider,
  PageSubnavProvider
} from '@/lib/components/page-header'

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

const getBar = (container: HTMLElement) =>
  container.querySelector('[data-mobile-compact-header]') as HTMLElement

describe('PageHeader', () => {
  it.each([
    {
      mode: 'sticky',
      selector: '.max-w-content > div',
      wrap: (header: ReactNode) => header
    },
    {
      mode: 'section',
      selector: '.mb-6 > div',
      wrap: (header: ReactNode) => (
        <PageHeaderSectionProvider>{header}</PageHeaderSectionProvider>
      )
    }
  ])(
    'stacks actions on mobile in $mode mode when stackActionsOnMobile is true',
    ({ selector, wrap }) => {
      const { container } = render(
        wrap(
          <PageHeader
            title="Lists & Collections"
            description="Private curated timelines"
            stackActionsOnMobile
            actions={<button type="button">New list</button>}
          />
        )
      )

      const flexContainer = container.querySelector(selector)
      expect(flexContainer).toHaveClass('flex-col')
      expect(flexContainer).toHaveClass('sm:flex-row')
      const actionWrapper = screen.getByRole('button', {
        name: 'New list'
      }).parentElement
      expect(actionWrapper).toHaveClass('self-start')
      expect(actionWrapper).toHaveClass('sm:self-center')
    }
  )

  it('keeps actions inline by default when stackActionsOnMobile is not set', () => {
    const { container } = render(
      <PageHeader
        title="Lists"
        actions={<button type="button">Action</button>}
      />
    )

    const flexContainer = container.querySelector('.max-w-content > div')
    expect(flexContainer).toHaveClass('items-start')
    expect(flexContainer).toHaveClass('justify-between')
    expect(flexContainer).not.toHaveClass('flex-col')
    const actionWrapper = screen.getByRole('button', {
      name: 'Action'
    }).parentElement
    expect(actionWrapper).toHaveClass('self-center')
    expect(actionWrapper).not.toHaveClass('self-start')
  })

  it('renders mobile navigation trigger in sticky mode when inside MobileNavigationProvider', () => {
    render(
      <MobileNavigationProvider>
        <PageHeader title="Timeline" />
      </MobileNavigationProvider>
    )

    expect(
      screen.getByRole('button', { name: 'Open navigation' })
    ).toBeInTheDocument()
  })

  it('does not render mobile navigation trigger in section mode even inside MobileNavigationProvider', () => {
    render(
      <MobileNavigationProvider>
        <PageHeaderSectionProvider>
          <PageHeader title="Section settings" />
        </PageHeaderSectionProvider>
      </MobileNavigationProvider>
    )

    expect(
      screen.queryByRole('button', { name: 'Open navigation' })
    ).not.toBeInTheDocument()
  })

  it('renders bottomSlot in sticky mode within an absolute overlay container below the header', () => {
    const { container } = render(
      <PageHeader
        title="Timeline"
        bottomSlot={<button type="button">1 new post ↑</button>}
      />
    )

    const button = screen.getByRole('button', { name: '1 new post ↑' })
    expect(button).toBeInTheDocument()

    const overlay = container.querySelector('.top-full')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveClass('pointer-events-none')
    expect(overlay).toHaveClass('absolute')
    expect(overlay).toHaveClass('pt-2')
    expect(overlay).toContainElement(button)
  })

  it('renders bottomSlot in section mode beneath subnav', () => {
    render(
      <PageHeaderSectionProvider>
        <PageHeader title="Settings" bottomSlot={<div>Section notice</div>} />
      </PageHeaderSectionProvider>
    )

    expect(screen.getByText('Section notice')).toBeInTheDocument()
  })

  it('renders the original sticky header, and no mobile bar, without a navigation provider', () => {
    const { container } = render(
      <PageHeader title="Timeline" description="Latest posts" />
    )

    expect(getBar(container)).toBeNull()
    const box = container.firstElementChild as HTMLElement
    expect(box).toHaveClass(
      'sticky',
      'top-0',
      'z-20',
      'border-b',
      'bg-surface-chrome',
      'backdrop-blur'
    )
    expect(screen.getByRole('heading', { name: 'Timeline' })).not.toHaveClass(
      'max-md:hidden'
    )
    // Nor the mobile description line: it belongs under the compact bar.
    const description = screen.getByText('Latest posts')
    expect(description).toHaveClass('mt-0.5', 'text-xs')
    expect(description).not.toHaveClass('max-md:text-sm')
    expect(description).not.toHaveClass('max-md:min-h-5')
    expect(description).not.toHaveClass('max-md:mt-0')
  })

  // 28px title + 2px + 16px description = 46px: a row with actions and no
  // description keeps that floor from md up, so the box stays 79px, with or
  // without the signed-in mobile navigation.
  it('keeps the described row height from md up for actions without a description', () => {
    const actions = <button type="button">Refresh</button>
    const { container, rerender } = render(
      <PageHeader title="Timeline" actions={actions} />
    )
    // The title row is the first child of the centered `max-w-content` row.
    const getRow = () =>
      container.querySelector('.max-w-content')?.firstElementChild

    expect(getRow()).toHaveClass('md:min-h-[46px]', 'items-start')

    rerender(
      <PageHeader
        title="Timeline"
        description="Latest posts"
        actions={actions}
      />
    )
    expect(getRow()).not.toHaveClass('md:min-h-[46px]')

    rerender(
      <MobileNavigationProvider>
        <PageHeader title="Timeline" actions={actions} />
      </MobileNavigationProvider>
    )
    expect(getRow()).toHaveClass('md:min-h-[46px]')
  })

  describe('mobile compact bar', () => {
    it('puts only the title in the bar and keeps description, actions and sub-nav in the content', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageSubnavProvider subnav={<nav aria-label="Filters">Tabs</nav>}>
            <PageHeader
              title="Notifications"
              description="Recent activity"
              actions={<button type="button">Mark all read</button>}
            />
          </PageSubnavProvider>
        </MobileNavigationProvider>
      )

      const bar = getBar(container)
      expect(
        within(bar).getByRole('heading', { name: 'Notifications' })
      ).toBeInTheDocument()
      expect(within(bar).queryByText('Recent activity')).toBeNull()
      expect(
        within(bar).queryByRole('button', { name: 'Mark all read' })
      ).toBeNull()
      expect(within(bar).queryByRole('navigation')).toBeNull()

      expect(screen.getByText('Recent activity')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Mark all read' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('navigation', { name: 'Filters' })
      ).toBeInTheDocument()
    })

    it('shows exactly one h1 per breakpoint: the bar below md, the header from md up', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageHeader title="Timeline" description="Latest posts" />
        </MobileNavigationProvider>
      )

      const headings = screen.getAllByRole('heading', {
        level: 1,
        name: 'Timeline'
      })
      expect(headings).toHaveLength(2)
      const [barHeading, boxHeading] = headings
      expect(getBar(container)).toContainElement(barHeading)
      // The class is the contract: CSS decides which one is displayed.
      expect(getBar(container)).toHaveClass('md:hidden')
      expect(boxHeading).toHaveClass('max-md:hidden')
    })

    it('renders back as a labelled link outside the heading', () => {
      render(
        <MobileNavigationProvider>
          <PageHeader
            title="Morning running crew"
            back={{ href: '/lists', accessibleName: 'Back to lists' }}
          />
        </MobileNavigationProvider>
      )

      // Visible "Back"; the accessible name names the destination.
      const link = screen.getByRole('link', { name: 'Back to lists' })
      expect(link).toHaveAttribute('href', '/lists')
      expect(link).toHaveTextContent(/^Back$/)
      for (const heading of screen.getAllByRole('heading')) {
        expect(heading).not.toContainElement(link)
      }
    })

    it('keeps the content heading visible when the bar carries a compact title', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageHeader
            title="Morning running crew"
            compactTitle="Lists"
            back={{ href: '/lists', accessibleName: 'Back to lists' }}
          />
        </MobileNavigationProvider>
      )

      expect(within(getBar(container)).getByText('Lists').tagName).toBe('P')
      const heading = screen.getByRole('heading', {
        level: 1,
        name: 'Morning running crew'
      })
      expect(heading).not.toHaveClass('max-md:hidden')
    })

    it('hides the content box below md when it would be empty', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageHeader title="Edit list" />
        </MobileNavigationProvider>
      )

      const box = container.querySelector('.max-w-content')
        ?.parentElement as HTMLElement
      expect(box).toHaveClass('max-md:hidden')
      // With the box gone, the bar keeps the parent's spacing to the content.
      expect(getBar(container)).not.toHaveClass('mb-0')
    })

    // Each of these alone gives the box something to show below md, so it
    // must stay visible and continue the bar (`mb-0`). The all-empty case
    // above only guards the other direction.
    it.each([
      {
        name: 'back',
        props: { back: { href: '/lists', accessibleName: 'Back to lists' } }
      },
      { name: 'description', props: { description: 'Latest posts' } },
      {
        name: 'actions',
        props: { actions: <button type="button">Refresh</button> }
      },
      { name: 'compactTitle', props: { compactTitle: 'Lists' } },
      { name: 'subnav', props: {}, subnav: <nav aria-label="Tabs">Tabs</nav> }
    ])(
      'keeps the content box below md when it has only $name',
      ({ props, subnav }) => {
        const { container } = render(
          <MobileNavigationProvider>
            <PageSubnavProvider subnav={subnav ?? null}>
              <PageHeader title="Edit list" {...props} />
            </PageSubnavProvider>
          </MobileNavigationProvider>
        )

        const box = container.querySelector('.max-w-content')
          ?.parentElement as HTMLElement
        expect(box).not.toHaveClass('max-md:hidden')
        expect(getBar(container)).toHaveClass('mb-0')
      }
    )

    it('renders the banner between the bar and the header box', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageHeader
            title="Timeline"
            description="Latest posts"
            banner={<div data-testid="banner">Maintenance tonight</div>}
          />
        </MobileNavigationProvider>
      )

      const children = Array.from(container.children)
      const bannerIndex = children.indexOf(screen.getByTestId('banner'))
      expect(children.indexOf(getBar(container))).toBe(bannerIndex - 1)
      expect(children[bannerIndex + 1]).toContainElement(
        container.querySelector('.max-w-content') as HTMLElement
      )
    })

    // The home timeline: the bar carries the title and Refresh, so the box is
    // hidden and the full-bleed composer meets the bar's hairline directly.
    it('lets the content meet the bar when the box is empty with flushOnMobile', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageHeader
            title="Timeline"
            actions={<button type="button">Refresh timeline</button>}
            actionsInMobileBar
            flushOnMobile
          />
        </MobileNavigationProvider>
      )

      const box = container.querySelector('.max-w-content')
        ?.parentElement as HTMLElement
      expect(box).toHaveClass('max-md:hidden')
      expect(getBar(container)).toHaveClass('mb-0')
    })

    // Without the signed-in mobile navigation (the logged-out home route's
    // loading state) the sticky box is the header's bottom edge.
    it('lets the content meet the sticky box with flushOnMobile and no navigation', () => {
      const { container } = render(
        <PageHeader
          title="Timeline"
          actions={<button type="button">Refresh timeline</button>}
          actionsInMobileBar
          flushOnMobile
        />
      )

      expect(getBar(container)).toBeNull()
      const box = container.firstElementChild as HTMLElement
      expect(box).toHaveClass('sticky', 'border-b', 'max-md:mb-0')
      expect(box).not.toHaveClass('mb-0')
    })

    // Signed in with something to show below md, the box continues the bar and
    // is the edge the content meets.
    it('lets the content meet a visible box under the bar with flushOnMobile', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageHeader
            title="Timeline"
            description="Latest posts"
            flushOnMobile
          />
        </MobileNavigationProvider>
      )

      const box = container.querySelector('.max-w-content')
        ?.parentElement as HTMLElement
      expect(box).not.toHaveClass('max-md:hidden')
      expect(box).toHaveClass('max-md:mb-0')
      expect(getBar(container)).toHaveClass('mb-0')
    })

    // Below md the description is the content row's own text on a 20px line,
    // flush with the row's top padding when the bar carries the title.
    it('sets the description as a flush 14/20 line when the bar holds the title', () => {
      render(
        <MobileNavigationProvider>
          <PageHeader title="Timeline" description="Latest posts" />
        </MobileNavigationProvider>
      )

      expect(screen.getByText('Latest posts')).toHaveClass(
        'mt-0.5',
        'text-xs',
        'max-md:min-h-5',
        'max-md:text-sm',
        'max-md:mt-0'
      )
    })

    it('keeps the description margin under a visible content heading', () => {
      render(
        <MobileNavigationProvider>
          <PageHeader
            title="Morning running crew"
            compactTitle="Lists"
            description="12 members"
          />
        </MobileNavigationProvider>
      )

      const description = screen.getByText('12 members')
      expect(description).toHaveClass('max-md:min-h-5', 'max-md:text-sm')
      expect(description).not.toHaveClass('max-md:mt-0')
    })

    it('moves actions into the bar below md with actionsInMobileBar', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageHeader
            title="Timeline"
            description="Latest posts"
            actions={<button type="button">Refresh timeline</button>}
            actionsInMobileBar
          />
        </MobileNavigationProvider>
      )

      const [barButton, boxButton] = screen.getAllByRole('button', {
        name: 'Refresh timeline'
      })
      const bar = getBar(container)
      expect(bar).toContainElement(barButton)
      // After the title, so it sits at the bar's end.
      expect(
        within(bar)
          .getByRole('heading', { level: 1, name: 'Timeline' })
          .compareDocumentPosition(barButton) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(bar).not.toContainElement(boxButton)
      expect(boxButton.parentElement).toHaveClass('shrink-0', 'max-md:hidden')
    })

    it('hides the content box below md when the bar carries its only actions', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageHeader
            title="Timeline"
            actions={<button type="button">Refresh timeline</button>}
            actionsInMobileBar
          />
        </MobileNavigationProvider>
      )

      const box = container.querySelector('.max-w-content')
        ?.parentElement as HTMLElement
      expect(box).toHaveClass('max-md:hidden')
      expect(getBar(container)).not.toHaveClass('mb-0')
    })

    // Without the signed-in mobile navigation there is no bar, so the
    // actions stay where they always were.
    it('ignores actionsInMobileBar without the signed-in mobile navigation', () => {
      render(
        <PageHeader
          title="Timeline"
          actions={<button type="button">Refresh timeline</button>}
          actionsInMobileBar
        />
      )

      const button = screen.getByRole('button', { name: 'Refresh timeline' })
      expect(button.parentElement).toHaveClass('shrink-0')
      expect(button.parentElement).not.toHaveClass('max-md:hidden')
    })

    it('hangs bottomSlot under the bar and hides the desktop overlay below md', () => {
      const { container } = render(
        <MobileNavigationProvider>
          <PageHeader
            title="Timeline"
            bottomSlot={<button type="button">2 new posts ↑</button>}
          />
        </MobileNavigationProvider>
      )

      const [barPill, boxPill] = screen.getAllByRole('button', {
        name: '2 new posts ↑'
      })
      expect(getBar(container)).toContainElement(barPill)
      expect(boxPill.closest('.top-full')).toHaveClass('max-md:hidden')
    })
  })
})
