/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { ReactNode } from 'react'

import { ListSummary, ListsIndex } from './ListsIndex'

vi.mock('@/lib/components/page-header', () => ({
  PageHeader: ({
    title,
    description,
    actions
  }: {
    title: ReactNode
    description: ReactNode
    actions: ReactNode
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      <div>{actions}</div>
    </div>
  )
}))

const baseList = (overrides: Partial<ListSummary>): ListSummary => ({
  id: 'list-1',
  title: 'Running club',
  replies_policy: 'list',
  exclusive: false,
  memberCount: 3,
  previewMembers: [],
  ...overrides
})

describe('ListsIndex', () => {
  it('renders the empty state with a create call to action', () => {
    render(<ListsIndex lists={[]} />)

    expect(
      screen.getByRole('heading', { name: 'Nothing here yet' })
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: /new list/i })[0]
    ).toHaveAttribute('href', '/lists/new')
    expect(
      screen.queryByRole('link', { name: /new collection/i })
    ).not.toBeInTheDocument()
  })

  it('puts the create action in the empty state itself, not only in the header', () => {
    render(<ListsIndex lists={[]} />)

    const empty = screen
      .getByRole('heading', { name: 'Nothing here yet' })
      .closest('[data-slot="empty-state"]') as HTMLElement
    expect(
      within(empty).getByRole('link', { name: /new list/i })
    ).toHaveAttribute('href', '/lists/new')
  })

  it('shows the lists as one list of rows', () => {
    render(<ListsIndex lists={[baseList({})]} />)

    expect(
      screen.queryByRole('heading', { name: 'Nothing here yet' })
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Lists' })).getAllByRole(
        'listitem'
      )
    ).toHaveLength(1)
  })

  it('links each list row to its timeline and summarizes membership', () => {
    render(
      <ListsIndex
        lists={[
          baseList({ id: 'a', title: 'Running club', memberCount: 3 }),
          baseList({
            id: 'b',
            title: 'Fediverse devs',
            memberCount: 3,
            exclusive: true
          }),
          baseList({ id: 'c', title: 'Conferences 2026', memberCount: 0 })
        ]}
      />
    )

    expect(screen.getByRole('link', { name: /Running club/ })).toHaveAttribute(
      'href',
      '/lists/a'
    )
    expect(screen.getByText('3 members')).toBeInTheDocument()
    expect(screen.getByText('3 members · Hidden from Home')).toBeInTheDocument()
    expect(screen.getByText('No members yet')).toBeInTheDocument()
  })
})
