/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { StatusStatStrip } from './StatusStatStrip'

describe('StatusStatStrip', () => {
  it('renders the reply, boost, and like counts in icon order', () => {
    render(<StatusStatStrip boosts={14} likes={96} replies={3} />)

    const region = screen.getByRole('group', { name: 'Engagement' })
    const counts = within(region).getAllByText(/^\d+$/)
    expect(counts.map((node) => node.textContent)).toEqual(['3', '14', '96'])
  })

  it.each([
    { boosts: 14, likes: 96, replies: 3, noun: 'replies', title: '3 replies' },
    { boosts: 14, likes: 96, replies: 3, noun: 'boosts', title: '14 boosts' },
    { boosts: 14, likes: 96, replies: 3, noun: 'likes', title: '96 likes' }
  ])(
    'labels the $noun stat for screen readers',
    ({ noun, title, ...props }) => {
      render(<StatusStatStrip {...props} />)

      const label = screen.getByText(noun)
      expect(label).toBeInTheDocument()
      expect(label.parentElement).toHaveAttribute('title', title)
    }
  )

  it('uses singular nouns when a count is one', () => {
    render(<StatusStatStrip boosts={1} likes={1} replies={1} />)

    expect(screen.getByText('reply')).toBeInTheDocument()
    expect(screen.getByText('boost')).toBeInTheDocument()
    expect(screen.getByText('like')).toBeInTheDocument()
  })

  it('renders zero counts rather than hiding them', () => {
    render(<StatusStatStrip boosts={0} likes={0} replies={0} />)

    expect(screen.getAllByText('0')).toHaveLength(3)
    expect(screen.getByText('replies')).toBeInTheDocument()
  })
})
