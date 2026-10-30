/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { RemoteStatusLoading } from './RemoteStatusLoading'

describe('RemoteStatusLoading', () => {
  it('announces the wait through one live region, not two', () => {
    render(<RemoteStatusLoading />)

    // `getByRole` throws on more than one match: the skeleton's status is the
    // only live region, and the info Alert is plain page content.
    expect(screen.getByRole('status')).toHaveTextContent('Fetching the status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('names the page with one heading and offers Check again', () => {
    render(<RemoteStatusLoading />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Fetching remote status' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Check again' })
    ).toBeInTheDocument()
  })
})
