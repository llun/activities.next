/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ProfileHeaderBlock, getInitials } from './ProfileHeaderBlock'

const renderBlock = (
  props: Partial<React.ComponentProps<typeof ProfileHeaderBlock>> = {}
) =>
  render(
    <ProfileHeaderBlock
      cover={<div data-testid="cover" />}
      initials="A"
      name="Anna"
      handle="@anna@llun.test"
      fields={[]}
      {...props}
    />
  )

describe('ProfileHeaderBlock', () => {
  it('draws the name as the page h1 by default', () => {
    renderBlock()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Anna' })
    ).toBeInTheDocument()
    expect(screen.getByText('@anna@llun.test')).toBeInTheDocument()
    expect(screen.getByTestId('cover')).toBeInTheDocument()
  })

  it('draws the name as a paragraph where the page has its own h1', () => {
    renderBlock({ nameAs: 'p' })

    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('Anna')).toBeInTheDocument()
  })

  it('renders the actions beside the name', () => {
    renderBlock({ actions: <button type="button">Follow</button> })

    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument()
  })

  it('renders the page-only extras after the links', () => {
    renderBlock({ children: <p>Running v2</p> })

    expect(screen.getByText('Running v2')).toBeInTheDocument()
  })
})

describe('getInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(getInitials('Anna', 'anna')).toBe('A')
    expect(getInitials('Anna Karenina', 'anna')).toBe('AK')
  })

  it('ignores :emoji: shortcodes', () => {
    expect(getInitials(':bird: Anna', 'anna')).toBe('A')
    expect(getInitials('Anna :bird: Karenina', 'anna')).toBe('AK')
  })

  it('falls back to the username when the name is empty', () => {
    expect(getInitials('', 'anna')).toBe('A')
    expect(getInitials('   ', 'anna')).toBe('A')
    expect(getInitials(':bird:', 'anna')).toBe('A')
  })
})
