/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Activity, Wrench } from 'lucide-react'

import {
  SectionNavSelect,
  type SectionNavSelectTab
} from '@/lib/components/section-nav-select'

type View = 'components' | 'activities'

const tabs: SectionNavSelectTab<View>[] = [
  { id: 'components', label: 'Components', icon: Wrench },
  { id: 'activities', label: 'Activities', icon: Activity }
]

const renderSelect = ({
  active = 'components' as View,
  onChange = vi.fn()
} = {}) => {
  render(
    <SectionNavSelect
      label="Gear sections"
      tabs={tabs}
      active={active}
      onChange={onChange}
    />
  )
  return { onChange }
}

// Open the Radix menu via keyboard (jsdom has no pointer layout), then scope
// assertions to the open menu.
const openMenu = async () => {
  const nav = screen.getByRole('navigation', { name: 'Gear sections' })
  fireEvent.keyDown(within(nav).getByRole('button'), { key: 'ArrowDown' })
  return screen.findByRole('menu')
}

describe('SectionNavSelect', () => {
  it('labels the nav landmark and names the active tab in the trigger', () => {
    renderSelect({ active: 'activities' })

    const nav = screen.getByRole('navigation', { name: 'Gear sections' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Activities')
  })

  it('falls back to the first tab when the active id matches nothing', () => {
    renderSelect({ active: 'nowhere' as View })

    const nav = screen.getByRole('navigation', { name: 'Gear sections' })
    expect(within(nav).getByRole('button')).toHaveTextContent('Components')
  })

  it('lists every tab and marks the active one current', async () => {
    renderSelect({ active: 'activities' })

    const menu = await openMenu()
    for (const label of ['Components', 'Activities']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeVisible()
    }
    // Nothing navigates here, so the boolean form rather than "page".
    expect(
      within(menu).getByRole('menuitem', { name: 'Activities' })
    ).toHaveAttribute('aria-current', 'true')
    expect(
      within(menu).getByRole('menuitem', { name: 'Components' })
    ).not.toHaveAttribute('aria-current')
  })

  it('keeps a focus indicator on the active row, which pins its own colours', async () => {
    // The active row holds its wash on `focus:`, and the shared menu item sets
    // `outline-hidden`, so without the ring the focused current row is
    // pixel-identical to its resting state — a keyboard user arrowing down the
    // list watches the highlight vanish on exactly one row (WCAG 2.4.7).
    // Asserted on the class string rather than a computed style because jsdom
    // does not evaluate Tailwind, exactly as the twin's suite does.
    renderSelect({ active: 'activities' })

    const menu = await openMenu()
    const active = within(menu).getByRole('menuitem', { name: 'Activities' })
    expect(active.className).toMatch(/focus:bg-primary\/10/)
    expect(active.className).toMatch(/focus:ring-2/)
    // `text-primary-text`, never `text-primary`: `--primary` is the icon
    // orange and is under the AA floor as a foreground. Nothing else in the
    // repo catches that regression on a text node.
    expect(active.className).toMatch(/text-primary-text/)

    expect(
      within(menu).getByRole('menuitem', { name: 'Components' }).className
    ).not.toMatch(/focus:ring-2/)
  })

  it('reports the chosen tab to its caller', async () => {
    const { onChange } = renderSelect({ active: 'components' })

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Activities' }))

    expect(onChange).toHaveBeenCalledWith('activities')
  })

  it('renders nothing when it has no tabs to offer', () => {
    const { container } = render(
      <SectionNavSelect
        label="Gear sections"
        tabs={[]}
        active={'components' as View}
        onChange={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
