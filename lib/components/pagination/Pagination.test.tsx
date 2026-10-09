/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { Pagination } from './Pagination'

// The visible sequence of the control: "Previous", page numbers, "..." gaps,
// "Next" — in document order.
const sequence = () =>
  Array.from(
    screen.getByRole('navigation', { name: 'Pagination' }).children
  ).map((child) => child.textContent)

describe('Pagination', () => {
  it.each([
    [0, 1],
    [1, 1]
  ])('renders nothing for %s page(s) total', (totalPages, currentPage) => {
    const { container } = render(
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        basePath="/admin/users"
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    [1, 5, ['1', '2', '3', '4', '5', 'Next']],
    [3, 5, ['Previous', '1', '2', '3', '4', '5', 'Next']],
    [5, 5, ['Previous', '1', '2', '3', '4', '5']],
    [4, 7, ['Previous', '1', '2', '3', '4', '5', '6', '7', 'Next']]
  ])(
    'lists every page without gaps on page %s of %s',
    (currentPage, totalPages, expected) => {
      render(
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          basePath="/admin/users"
        />
      )

      expect(sequence()).toEqual(expected)
    }
  )

  it.each([
    [1, ['1', '2', '...', '10', 'Next']],
    [3, ['Previous', '1', '2', '3', '4', '...', '10', 'Next']],
    [4, ['Previous', '1', '...', '3', '4', '5', '...', '10', 'Next']],
    [5, ['Previous', '1', '...', '4', '5', '6', '...', '10', 'Next']],
    [8, ['Previous', '1', '...', '7', '8', '9', '10', 'Next']],
    [9, ['Previous', '1', '...', '8', '9', '10', 'Next']],
    [10, ['Previous', '1', '...', '9', '10']]
  ])(
    'collapses distant pages into gaps on page %s of 10',
    (currentPage, expected) => {
      render(
        <Pagination
          currentPage={currentPage}
          totalPages={10}
          basePath="/admin/users"
        />
      )

      expect(sequence()).toEqual(expected)
    }
  )

  it('links Previous and Next to the adjacent pages', () => {
    render(
      <Pagination currentPage={4} totalPages={9} basePath="/admin/users" />
    )

    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/admin/users?page=3'
    )
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/admin/users?page=5'
    )
  })

  it('links each page number to its own page', () => {
    render(
      <Pagination currentPage={2} totalPages={3} basePath="/admin/users" />
    )

    const nav = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(nav).getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/admin/users?page=1'
    )
    expect(within(nav).getByRole('link', { name: '3' })).toHaveAttribute(
      'href',
      '/admin/users?page=3'
    )
  })

  it('preserves extra query params on every link and encodes them', () => {
    render(
      <Pagination
        currentPage={2}
        totalPages={3}
        basePath="/admin/users"
        query={{ filter: 'a b&c', sort: 'name' }}
      />
    )

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(5)
    for (const link of links) {
      const url = new URL(link.getAttribute('href') as string, 'http://x')
      expect(url.pathname).toBe('/admin/users')
      expect(url.searchParams.get('filter')).toBe('a b&c')
      expect(url.searchParams.get('sort')).toBe('name')
      expect(url.searchParams.get('page')).toMatch(/^[1-3]$/)
    }
  })

  it('lets the page number override a page key in the preserved query', () => {
    render(
      <Pagination
        currentPage={1}
        totalPages={2}
        basePath="/admin/users"
        query={{ page: '99' }}
      />
    )

    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/admin/users?page=2'
    )
  })
})
