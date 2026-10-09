/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import Loading from './loading'

describe('search loading', () => {
  it('is busy and announces one polite "Loading search"', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading search')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('outlines the header, search form and results with no loading text', () => {
    const { container } = render(<Loading />)

    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(screen.getByLabelText('Search form')).toBeInTheDocument()
    expect(screen.queryByLabelText('Post composer')).toBeNull()
    // The only text is the screen-reader status.
    expect(container).toHaveTextContent(/^Loading search$/)
  })

  it('is scoped to the search route so it does not cascade to other (timeline) subroutes', () => {
    const rootTimelineLoadingPath = path.resolve(
      process.cwd(),
      'app/(timeline)/loading.tsx'
    )
    expect(fs.existsSync(rootTimelineLoadingPath)).toBe(false)
  })
})
