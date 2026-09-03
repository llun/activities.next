/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Profile } from './profile'

describe('Profile component', () => {
  it('renders all counts when provided as numbers', () => {
    render(
      <Profile
        name="Test User"
        username="test"
        domain="example.com"
        url="https://example.com/@test"
        totalPosts={10}
        followingCount={20}
        followersCount={30}
        createdAt={1700000000000}
      />
    )

    expect(screen.getByText('10 Posts')).toBeInTheDocument()
    expect(screen.getByText('20 Following')).toBeInTheDocument()
    expect(screen.getByText('30 Followers')).toBeInTheDocument()
  })

  it('omits Following when followingCount is null', () => {
    render(
      <Profile
        name="Test User"
        username="test"
        domain="example.com"
        url="https://example.com/@test"
        totalPosts={10}
        followingCount={null}
        followersCount={30}
        createdAt={1700000000000}
      />
    )

    expect(screen.getByText('10 Posts')).toBeInTheDocument()
    expect(screen.queryByText(/Following/)).not.toBeInTheDocument()
    expect(screen.getByText('30 Followers')).toBeInTheDocument()
  })

  it('omits Followers when followersCount is null', () => {
    render(
      <Profile
        name="Test User"
        username="test"
        domain="example.com"
        url="https://example.com/@test"
        totalPosts={10}
        followingCount={20}
        followersCount={null}
        createdAt={1700000000000}
      />
    )

    expect(screen.getByText('10 Posts')).toBeInTheDocument()
    expect(screen.getByText('20 Following')).toBeInTheDocument()
    expect(screen.queryByText(/Followers/)).not.toBeInTheDocument()
  })

  it('omits both when both are null', () => {
    render(
      <Profile
        name="Test User"
        username="test"
        domain="example.com"
        url="https://example.com/@test"
        totalPosts={10}
        followingCount={null}
        followersCount={null}
        createdAt={1700000000000}
      />
    )

    expect(screen.getByText('10 Posts')).toBeInTheDocument()
    expect(screen.queryByText(/Following/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Followers/)).not.toBeInTheDocument()
  })
})
