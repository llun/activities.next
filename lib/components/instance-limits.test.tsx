/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { FC } from 'react'

import { DEFAULT_MAX_STATUS_CHARACTERS } from '@/lib/services/mastodon/constants'
import { MAX_FILE_SIZE } from '@/lib/services/medias/constants'

import { InstanceLimitsProvider, useInstanceLimits } from './instance-limits'

const LimitsProbe: FC = () => {
  const { maxStatusCharacters, maxMediaFileSize } = useInstanceLimits()
  return (
    <>
      <span data-testid="max-status-characters">{maxStatusCharacters}</span>
      <span data-testid="max-media-file-size">{maxMediaFileSize}</span>
    </>
  )
}

describe('useInstanceLimits', () => {
  it('falls back to the built-in defaults without a provider', () => {
    render(<LimitsProbe />)

    expect(screen.getByTestId('max-status-characters')).toHaveTextContent(
      String(DEFAULT_MAX_STATUS_CHARACTERS)
    )
    expect(screen.getByTestId('max-media-file-size')).toHaveTextContent(
      String(MAX_FILE_SIZE)
    )
  })

  it.each([
    {
      description: 'serves the resolved limits from the provider',
      maxStatusCharacters: 1000,
      maxMediaFileSize: 5_000_000,
      expectedCharacters: '1000',
      expectedFileSize: '5000000'
    },
    {
      description: 'falls back to the defaults for omitted values',
      maxStatusCharacters: undefined,
      maxMediaFileSize: undefined,
      expectedCharacters: String(DEFAULT_MAX_STATUS_CHARACTERS),
      expectedFileSize: String(MAX_FILE_SIZE)
    },
    {
      description: 'falls back to the defaults for zero',
      maxStatusCharacters: 0,
      maxMediaFileSize: 0,
      expectedCharacters: String(DEFAULT_MAX_STATUS_CHARACTERS),
      expectedFileSize: String(MAX_FILE_SIZE)
    },
    {
      description: 'falls back to the defaults for negative values',
      maxStatusCharacters: -1,
      maxMediaFileSize: -1,
      expectedCharacters: String(DEFAULT_MAX_STATUS_CHARACTERS),
      expectedFileSize: String(MAX_FILE_SIZE)
    },
    {
      description: 'falls back to the defaults for fractional values',
      maxStatusCharacters: 500.5,
      maxMediaFileSize: 1024.5,
      expectedCharacters: String(DEFAULT_MAX_STATUS_CHARACTERS),
      expectedFileSize: String(MAX_FILE_SIZE)
    },
    {
      description: 'falls back to the defaults for NaN',
      maxStatusCharacters: Number.NaN,
      maxMediaFileSize: Number.NaN,
      expectedCharacters: String(DEFAULT_MAX_STATUS_CHARACTERS),
      expectedFileSize: String(MAX_FILE_SIZE)
    }
  ])(
    '$description',
    ({
      maxStatusCharacters,
      maxMediaFileSize,
      expectedCharacters,
      expectedFileSize
    }) => {
      render(
        <InstanceLimitsProvider
          maxStatusCharacters={maxStatusCharacters}
          maxMediaFileSize={maxMediaFileSize}
        >
          <LimitsProbe />
        </InstanceLimitsProvider>
      )

      expect(screen.getByTestId('max-status-characters')).toHaveTextContent(
        expectedCharacters
      )
      expect(screen.getByTestId('max-media-file-size')).toHaveTextContent(
        expectedFileSize
      )
    }
  )
})
