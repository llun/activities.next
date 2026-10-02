/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

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

  it('draws the radio indicator as a 6 px dot', () => {
    renderMenu()
    const row = screen
      .getByText('Radio Option')
      .closest('[role="menuitemradio"]') as HTMLElement
    const dot = row.querySelector('span > span > span')
    expect(dot).toHaveClass('size-1.5', 'rounded-full', 'bg-current')
    expect(row.querySelector('svg')).toBeNull()
  })
})
