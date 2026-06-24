/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { ReactNode } from 'react'

import { CollectionSummary, ListSummary, ListsIndex } from './ListsIndex'

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

const baseCollection = (
  overrides: Partial<CollectionSummary>
): CollectionSummary => ({
  id: 'col-1',
  title: 'Fediverse builders',
  description: null,
  topic: null,
  language: null,
  visibility: 'public',
  feed_enabled: true,
  size: 2,
  memberCount: 5,
  ...overrides
})

describe('ListsIndex', () => {
  it('renders the empty state with both create calls to action', () => {
    render(<ListsIndex lists={[]} collections={[]} />)

    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: /new list/i })[0]
    ).toHaveAttribute('href', '/lists/new')
    expect(
      screen.getAllByRole('link', { name: /new collection/i })[0]
    ).toHaveAttribute('href', '/collections/new')
  })

  it('links each list row to its timeline and summarizes membership', () => {
    render(
      <ListsIndex
        collections={[]}
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

  it('links each collection row to its detail and summarizes featured count', () => {
    render(
      <ListsIndex
        lists={[]}
        collections={[
          baseCollection({
            id: 'x',
            title: 'Fediverse builders',
            memberCount: 5,
            size: 2
          }),
          baseCollection({
            id: 'y',
            title: 'Empty collection',
            memberCount: 0,
            size: 0
          })
        ]}
      />
    )

    expect(
      screen.getByRole('link', { name: /Fediverse builders/ })
    ).toHaveAttribute('href', '/collections/x')
    expect(
      screen.getByText('5 people · 2 featured publicly')
    ).toBeInTheDocument()
    expect(screen.getByText('No one yet')).toBeInTheDocument()
  })
})
