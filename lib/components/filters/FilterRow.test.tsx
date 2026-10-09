/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ClientFilter } from '@/lib/client'
import { contrastRatio } from '@/lib/testing/contrast'

import { FilterRow } from './FilterRow'

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
  it('keeps the context chip label at or above the 4.5:1 AA floor on its fill', () => {
    renderRow(filterFor(['home']))

    // Read the pair off the rendered chip, so the ratio is the one the row
    // ships. The fill and the dark label are grey hsl() values (0 0% N%).
    const { className } = screen.getByText('Home')
    const read = (pattern: RegExp) => {
      const match = className.match(pattern)
      if (!match) throw new Error(`${pattern} not found in "${className}"`)
      return match[1]
    }
    const greyHex = (lightness: string) =>
      `#${Math.round(Number(lightness) * 2.55)
        .toString(16)
        .padStart(2, '0')
        .repeat(3)}`

    const fill = greyHex(read(/(?:^|\s)bg-\[hsl\(0_0%_(\d+)%\)\]/))
    const lightLabel = read(/(?:^|\s)text-\[(#[0-9A-Fa-f]{6})\]/)
    const darkLabel = greyHex(read(/dark:text-\[hsl\(0_0%_(\d+)%\)\]/))

    expect(contrastRatio(lightLabel, fill)).toBeGreaterThanOrEqual(4.7)
    expect(contrastRatio(darkLabel, fill)).toBeGreaterThanOrEqual(4.5)
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
