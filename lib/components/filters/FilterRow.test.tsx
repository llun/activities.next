/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ClientFilter } from '@/lib/client'

import { FilterRow } from './FilterRow'

const filterFor = (context: string[], filterAction = 'warn') =>
  ({
    id: 'f-1',
    title: 'Spoilers',
    context,
    filter_action: filterAction,
    expires_at: null,
    keywords: []
  }) as unknown as ClientFilter

const renderRow = (filter: ClientFilter) =>
  render(
    <FilterRow
      filter={filter}
      currentTime={0}
      onEdit={() => {}}
      onDelete={() => {}}
    />
  )

describe('FilterRow', () => {
  // The context chip keeps the light #F0F0F0 fill in both themes; its label is
  // the design's Badge Gray Fg (#6E6E6E) on the light page and the darker
  // #595959 on the dark row.
  it('draws the context chips in #6E6E6E in light and #595959 in dark', () => {
    renderRow(filterFor(['home', 'public']))

    for (const label of ['Home', 'Public']) {
      const chip = screen.getByText(label)
      expect(chip).toHaveClass('bg-[hsl(0_0%_94%)]', 'text-[#6E6E6E]')
      expect(chip.className).toContain('dark:text-[hsl(0_0%_35%)]')
    }
  })

  it('collapses every context into a single Everywhere chip', () => {
    renderRow(
      filterFor(['home', 'notifications', 'public', 'thread', 'account'])
    )

    expect(screen.getByText('Everywhere')).toHaveClass('text-[#6E6E6E]')
    expect(screen.queryByText('Home')).not.toBeInTheDocument()
  })

  it('renders the action badge through the shared Badge tones', () => {
    renderRow(filterFor(['home'], 'hide'))

    const badge = screen.getByText('Hide completely')
    expect(badge).toHaveClass('text-destructive-text')
    expect(badge.className).toContain('dark:bg-[#DF3A3A]/16')
  })
})
