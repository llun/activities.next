/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { NOW, profile } from '@/lib/components/drafts/draftFixtures.testUtils'

import { DraftsPage } from './DraftsPage'

vi.mock('@/lib/components/drafts/DraftsList', () => ({
  DraftsList: (props: { host: string; currentTime: number }) => (
    <p data-testid="list">{`${props.host} ${props.currentTime}`}</p>
  )
}))

describe('DraftsPage', () => {
  it('titles the page, notes where drafts live and renders the list', () => {
    render(<DraftsPage host="llun.test" profile={profile} currentTime={NOW} />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Drafts' })
    ).toBeInTheDocument()
    expect(screen.getByText('Saved on this device')).toBeInTheDocument()
    expect(screen.getByTestId('list')).toHaveTextContent(`llun.test ${NOW}`)
  })
})
