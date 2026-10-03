/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ClientFilter } from '@/lib/client'

import { FilterRow } from './FilterRow'

// WCAG 2.1 contrast ratio of two #RRGGBB colours.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrastRatio = (foreground: string, background: string) => {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  )
  return (hi + 0.05) / (lo + 0.05)
}

const filterFor = (
  context: string[],
  filterAction = 'warn',
  expiresAt: string | null = null
) =>
  ({
    id: 'f-1',
    title: 'Spoilers',
    context,
    filter_action: filterAction,
    expires_at: expiresAt,
    keywords: []
  }) as unknown as ClientFilter

const renderRow = (filter: ClientFilter, currentTime = 0) =>
  render(
    <FilterRow
      filter={filter}
      currentTime={currentTime}
      onEdit={() => {}}
      onDelete={() => {}}
    />
  )

describe('FilterRow', () => {
  // The context chip keeps the light #F0F0F0 fill (hsl 0 0% 94%) in both
  // themes. The design's Badge Gray Fg (#6E6E6E) only reaches 4.47:1 on it, so
  // the chip's light label is the darker #6A6A6A (4.75:1); on the dark row the
  // label is #595959 (6.15:1).
  it('draws the context chips in #6A6A6A in light and #595959 in dark', () => {
    renderRow(filterFor(['home', 'public']))

    for (const label of ['Home', 'Public']) {
      const chip = screen.getByText(label)
      expect(chip).toHaveClass('bg-[hsl(0_0%_94%)]', 'text-[#6A6A6A]')
      expect(chip).not.toHaveClass('text-[#6E6E6E]')
      expect(chip.className).toContain('dark:text-[hsl(0_0%_35%)]')
    }
  })

  it('keeps the context chip label at or above the 4.5:1 AA floor on its fill', () => {
    // #F0F0F0 is hsl(0 0% 94%), the chip's fill in both themes.
    expect(contrastRatio('#6A6A6A', '#F0F0F0')).toBeGreaterThanOrEqual(4.7)
    expect(contrastRatio('#595959', '#F0F0F0')).toBeGreaterThanOrEqual(4.5)
  })

  it('collapses every context into a single Everywhere chip', () => {
    renderRow(
      filterFor(['home', 'notifications', 'public', 'thread', 'account'])
    )

    expect(screen.getByText('Everywhere')).toHaveClass('text-[#6A6A6A]')
    expect(screen.queryByText('Home')).not.toBeInTheDocument()
  })

  // The row only chooses the tone; the Badge's own fills are pinned in
  // badge.test.tsx.
  it.each([
    {
      description: 'hide completely in the destructive tone',
      action: 'hide',
      label: 'Hide completely',
      token: 'text-destructive-text'
    },
    {
      description: 'hide with warning in the primary tone',
      action: 'warn',
      label: 'Hide with warning',
      token: 'text-primary-text'
    }
  ])('draws $description', ({ action, label, token }) => {
    renderRow(filterFor(['home'], action))

    expect(screen.getByText(label)).toHaveClass(token)
  })

  // The meta line reads "Expired <date>", so an exact-text query for
  // "Expired" can only match the pill.
  it('shows the Expired pill once the expiry has passed', () => {
    renderRow(
      filterFor(['home'], 'warn', '2026-01-01T00:00:00.000Z'),
      Date.parse('2026-06-01T00:00:00.000Z')
    )

    expect(screen.getByText('Expired')).toBeInTheDocument()
  })

  it.each([
    { description: 'never expires', expiresAt: null },
    { description: 'expires later', expiresAt: '2026-12-01T00:00:00.000Z' }
  ])(
    'omits the Expired pill for a filter that $description',
    ({ expiresAt }) => {
      renderRow(
        filterFor(['home'], 'warn', expiresAt),
        Date.parse('2026-06-01T00:00:00.000Z')
      )

      expect(screen.queryByText('Expired')).not.toBeInTheDocument()
    }
  )
})
