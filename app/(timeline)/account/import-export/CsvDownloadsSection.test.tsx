/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { csvExportUrl } from '@/lib/client/bulkImports'

import { CsvDownloadsSection } from './CsvDownloadsSection'

const CSV_FILES = [
  ['following_accounts.csv', 'Following'],
  ['lists.csv', 'Lists'],
  ['muted_accounts.csv', 'Muted accounts'],
  ['blocked_accounts.csv', 'Blocked accounts'],
  ['blocked_domains.csv', 'Blocked domains'],
  ['bookmarks.csv', 'Bookmarks']
] as const

describe('CsvDownloadsSection', () => {
  it('shows six actor-scoped CSV downloads using the server export paths', () => {
    render(<CsvDownloadsSection actorId="actor/one" />)

    const links = screen.getAllByRole('link', { name: /Download CSV/ })
    expect(links).toHaveLength(6)
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      CSV_FILES.map(([file]) => csvExportUrl(file, 'actor/one'))
    )
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(
      CSV_FILES.map(([, name]) => `Download CSV (${name})`)
    )
    expect(
      screen.getByText(/Followers are in the archive only/)
    ).toBeInTheDocument()
    expect(
      within(
        screen.getByRole('region', { name: 'Spreadsheet downloads' })
      ).getAllByRole('link')
    ).toHaveLength(6)
  })
})
