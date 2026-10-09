/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ClientFilter } from '@/lib/client'

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
  it('lists a chip for each context the filter applies to', () => {
    renderRow(filterFor(['home', 'public']))

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Public')).toBeInTheDocument()
    expect(screen.queryByText('Everywhere')).not.toBeInTheDocument()
  })

  it('collapses every context into a single Everywhere chip', () => {
    renderRow(
      filterFor(['home', 'notifications', 'public', 'thread', 'account'])
    )

    expect(screen.getByText('Everywhere')).toBeInTheDocument()
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
