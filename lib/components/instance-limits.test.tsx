/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { FC } from 'react'

import { DEFAULT_MAX_STATUS_CHARACTERS } from '@/lib/services/mastodon/constants'

import { InstanceLimitsProvider, useInstanceLimits } from './instance-limits'

const LimitsProbe: FC = () => {
  const { maxStatusCharacters } = useInstanceLimits()
  return <span data-testid="limit">{maxStatusCharacters}</span>
}

describe('useInstanceLimits', () => {
  it('falls back to the default status length without a provider', () => {
    render(<LimitsProbe />)
    expect(screen.getByTestId('limit')).toHaveTextContent(
      String(DEFAULT_MAX_STATUS_CHARACTERS)
    )
  })

  it('serves the resolved status length from the provider', () => {
    render(
      <InstanceLimitsProvider maxStatusCharacters={1000}>
        <LimitsProbe />
      </InstanceLimitsProvider>
    )
    expect(screen.getByTestId('limit')).toHaveTextContent('1000')
  })

  it.each([
    { description: 'an omitted value', value: undefined },
    { description: 'zero', value: 0 },
    { description: 'a negative value', value: -1 },
    { description: 'a fractional value', value: 500.5 },
    { description: 'NaN', value: Number.NaN }
  ])('falls back to the default for $description', ({ value }) => {
    render(
      <InstanceLimitsProvider maxStatusCharacters={value}>
        <LimitsProbe />
      </InstanceLimitsProvider>
    )
    expect(screen.getByTestId('limit')).toHaveTextContent(
      String(DEFAULT_MAX_STATUS_CHARACTERS)
    )
  })
})
