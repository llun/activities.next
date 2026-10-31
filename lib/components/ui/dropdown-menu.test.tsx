/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from './dropdown-menu'

const renderMenu = () =>
  render(
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked>
          Show preview
        </DropdownMenuCheckboxItem>
        <DropdownMenuRadioGroup value="a">
          <DropdownMenuRadioItem value="a">Radio Option</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Translate to</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>English</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )

describe('DropdownMenu', () => {
  // The design's dark hover fill is Surface/Muted (#2B2B2B), a step lighter than
  // the --accent (#262626) the items used before; light stays --accent.
  it.each([
    ['item', 'Profile'],
    ['checkbox item', 'Show preview'],
    ['radio item', 'Radio Option'],
    ['sub trigger', 'Translate to']
  ])(
    'highlights a %s with --accent in light and --muted in dark',
    (_, label) => {
      renderMenu()
      const row = screen.getByText(label).closest('[role^="menuitem"]')
      expect(row).toHaveClass('focus:bg-accent', 'dark:focus:bg-muted')
    }
  )

  // The row that opened a submenu keeps the same fill as a hovered one, so the
  // two never differ by a step in dark.
  it('keeps the sub trigger on --muted in dark while its submenu is open', () => {
    renderMenu()
    const row = screen.getByText('Translate to').closest('[role="menuitem"]')
    expect(row).toHaveClass(
      'data-[state=open]:bg-accent',
      'dark:data-[state=open]:bg-muted'
    )
  })

  it('draws the radio indicator as a 6 px dot', () => {
    renderMenu()
    const row = screen
      .getByText('Radio Option')
      .closest('[role="menuitemradio"]') as HTMLElement
    const dot = row.querySelector('span > span > span')
    expect(dot).toHaveClass('size-1.5', 'rounded-full', 'bg-current')
    expect(row.querySelector('svg')).toBeNull()
  })

  // A phone has no room for a submenu beside its menu (Radix flips it off the
  // screen's edge), so there it expands inline under its row.
  describe('on a phone', () => {
    const originalMatchMedia = window.matchMedia

    beforeEach(() => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 47.99rem)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })) as unknown as typeof window.matchMedia
    })

    afterEach(() => {
      cleanup()
      window.matchMedia = originalMatchMedia
    })

    it('expands the submenu inline when its row is chosen', () => {
      renderMenu()
      const row = screen.getByText('Translate to').closest('[role="menuitem"]')
      expect(row).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('English')).not.toBeInTheDocument()

      fireEvent.click(row as HTMLElement)

      expect(row).toHaveAttribute('aria-expanded', 'true')
      expect(row).toHaveAttribute('data-state', 'open')
      const group = screen.getByText('English').closest('[role="group"]')
      expect(group).toHaveAttribute('data-inline')
      expect(group).toHaveAccessibleName('Translate to')
      expect(row).toHaveAttribute('aria-controls', group?.id)
      // Inside the menu itself, not a second floating menu.
      expect(screen.getAllByRole('menu')).toHaveLength(1)
      expect(screen.getByRole('menu')).toContainElement(group as HTMLElement)

      fireEvent.click(row as HTMLElement)
      expect(row).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('English')).not.toBeInTheDocument()
    })

    it('opens with the right arrow key and closes with the left', () => {
      renderMenu()
      const row = screen
        .getByText('Translate to')
        .closest('[role="menuitem"]') as HTMLElement
      fireEvent.keyDown(row, { key: 'ArrowRight' })
      expect(screen.getByText('English')).toBeInTheDocument()
      fireEvent.keyDown(row, { key: 'ArrowLeft' })
      expect(screen.queryByText('English')).not.toBeInTheDocument()
    })

    it('keeps a disabled submenu closed', () => {
      render(
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled>
                Translate to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>English</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      const row = screen
        .getByText('Translate to')
        .closest('[role="menuitem"]') as HTMLElement
      fireEvent.click(row)
      fireEvent.keyDown(row, { key: 'ArrowRight' })
      expect(screen.queryByText('English')).not.toBeInTheDocument()
    })

    it('closes the whole menu when an inline option is chosen', () => {
      const onOpenChange = vi.fn()
      const onSelect = vi.fn()
      render(
        <DropdownMenu open modal={false} onOpenChange={onOpenChange}>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub defaultOpen>
              <DropdownMenuSubTrigger>Translate to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={onSelect}>English</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      fireEvent.click(screen.getByText('English'))
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
