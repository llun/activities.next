/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Checkbox } from './checkbox'

describe('Checkbox', () => {
  it('is still a native checkbox input drawn without the platform paint', () => {
    render(<Checkbox aria-label="Notifications" />)
    const box = screen.getByRole('checkbox', { name: 'Notifications' })
    expect(box.tagName).toBe('INPUT')
    expect(box).toHaveAttribute('type', 'checkbox')
    expect(box).toHaveAttribute('data-slot', 'checkbox')
    expect(box).toHaveClass('appearance-none')
  })

  it('hands the box back to the platform in forced-colors mode', () => {
    render(<Checkbox aria-label="Box" />)
    const box = screen.getByRole('checkbox')
    // A white tick on a forced light palette would hide a checked box (the
    // consent card pre-checks every scope), so the native checkbox returns.
    expect(box).toHaveClass('appearance-none', 'forced-colors:appearance-auto')
  })

  it('keeps a keyboard focus indicator and the disabled colours in forced-colors mode', () => {
    render(<Checkbox aria-label="Box" />)
    const box = screen.getByRole('checkbox')
    // Forced-colors mode drops the box-shadow focus ring (the box is
    // `outline-none`), so keyboard focus gets the native outline back; and the
    // system already dims a disabled box, so `disabled:opacity-50` is reset
    // there rather than halving that contrast a second time.
    expect(box).toHaveClass(
      'forced-colors:focus-visible:[outline-style:auto]',
      'forced-colors:disabled:opacity-100'
    )
  })

  it('draws the designed 16 px box with radius 4 and a thin border', () => {
    render(<Checkbox aria-label="Box" />)
    const box = screen.getByRole('checkbox')
    expect(box).toHaveClass('size-4', 'rounded', 'border', 'border-input')
  })

  it('fills the checked box orange and paints a white tick', () => {
    render(<Checkbox aria-label="Box" />)
    const box = screen.getByRole('checkbox')
    expect(box).toHaveClass('checked:bg-primary', 'checked:border-primary')
    const tick = Array.from(box.classList).find((name) =>
      name.startsWith('checked:bg-[url(data:image/svg+xml')
    )
    // A thin white tick on the 24 grid: stroke #FFFFFF, width 2 (1 px at 12 px).
    expect(tick).toContain('stroke%3D%22%23FFFFFF%22')
    expect(tick).toContain('stroke-width%3D%222%22')
  })

  it('lets a call site pick its own size and tick size', () => {
    render(
      <Checkbox
        aria-label="Box"
        className="size-[18px] bg-[length:14px_14px]"
      />
    )
    const box = screen.getByRole('checkbox')
    expect(box).toHaveClass('size-[18px]', 'bg-[length:14px_14px]')
    expect(box).not.toHaveClass('size-4', 'bg-[length:12px_12px]')
  })

  it('stays a real form control: it posts its name and value only when checked', () => {
    const { container } = render(
      <form>
        <Checkbox name="scope" value="read" defaultChecked aria-label="read" />
        <Checkbox
          name="scope"
          value="write"
          defaultChecked
          aria-label="write"
        />
      </form>
    )
    const form = container.querySelector('form') as HTMLFormElement
    expect(new FormData(form).getAll('scope')).toEqual(['read', 'write'])

    fireEvent.click(screen.getByRole('checkbox', { name: 'write' }))
    expect(new FormData(form).getAll('scope')).toEqual(['read'])
  })

  it('toggles from its label like the unstyled control', () => {
    render(
      <>
        <Checkbox id="trust" />
        <label htmlFor="trust">Trust this device</label>
      </>
    )
    const box = screen.getByLabelText('Trust this device')
    expect(box).not.toBeChecked()
    fireEvent.click(screen.getByText('Trust this device'))
    expect(box).toBeChecked()
  })

  it('does not toggle or post while disabled', () => {
    const { container } = render(
      <form>
        <Checkbox name="scope" value="openid" defaultChecked disabled />
      </form>
    )
    const box = screen.getByRole('checkbox')
    expect(box).toBeDisabled()
    expect(box).toHaveClass('disabled:opacity-50')
    const form = container.querySelector('form') as HTMLFormElement
    expect(new FormData(form).getAll('scope')).toEqual([])
  })
})
