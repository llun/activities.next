/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { InstanceLimitsProvider } from '@/lib/components/instance-limits'

import { Choice, PollChoices } from './poll-choices'

const buildChoices = (count: number): Choice[] =>
  Array.from({ length: count }, (_, index) => ({
    key: index,
    text: `Choice ${index + 1}`
  }))

interface RenderOptions {
  choiceCount?: number
  durationInSeconds?: number
  maxPollOptions?: number
  maxPollOptionCharacters?: number
  minPollExpirationSeconds?: number
  maxPollExpirationSeconds?: number
  onChooseDuration?: (durationInSeconds: number) => void
}

const renderPollChoices = ({
  choiceCount = 2,
  durationInSeconds = 86_400,
  maxPollOptions,
  maxPollOptionCharacters,
  minPollExpirationSeconds,
  maxPollExpirationSeconds,
  onChooseDuration = vi.fn()
}: RenderOptions = {}) =>
  render(
    <InstanceLimitsProvider
      maxPollOptions={maxPollOptions}
      maxPollOptionCharacters={maxPollOptionCharacters}
      minPollExpirationSeconds={minPollExpirationSeconds}
      maxPollExpirationSeconds={maxPollExpirationSeconds}
    >
      <PollChoices
        show
        choices={buildChoices(choiceCount)}
        durationInSeconds={durationInSeconds as never}
        pollType="oneOf"
        onAddChoice={vi.fn()}
        onRemoveChoice={vi.fn()}
        onChooseDuration={onChooseDuration as never}
        onPollTypeChange={vi.fn()}
        onRemove={vi.fn()}
      />
    </InstanceLimitsProvider>
  )

// The create endpoints enforce the resolved polls.* limits, so the editor must
// never let a poll be built that they will reject.
describe('PollChoices', () => {
  it.each([
    {
      description: 'offers another choice below the configured maximum',
      choiceCount: 3,
      maxPollOptions: 4,
      expectAddChoice: true
    },
    {
      description: 'stops offering choices at the configured maximum',
      choiceCount: 4,
      maxPollOptions: 4,
      expectAddChoice: false
    },
    {
      description: 'offers more choices when the maximum is raised',
      choiceCount: 4,
      maxPollOptions: 6,
      expectAddChoice: true
    }
  ])('$description', ({ choiceCount, maxPollOptions, expectAddChoice }) => {
    renderPollChoices({ choiceCount, maxPollOptions })

    const addChoice = screen.queryByRole('button', { name: 'Add choice' })
    if (expectAddChoice) expect(addChoice).toBeInTheDocument()
    else expect(addChoice).not.toBeInTheDocument()
  })

  it('caps each choice input at the configured option length', () => {
    renderPollChoices({ maxPollOptionCharacters: 25 })

    for (const input of screen.getAllByPlaceholderText(/^Choice /)) {
      expect(input).toHaveAttribute('maxlength', '25')
    }
  })

  it('only offers durations inside the configured expiry range', () => {
    renderPollChoices({
      durationInSeconds: 86_400,
      minPollExpirationSeconds: 3_600,
      maxPollExpirationSeconds: 259_200
    })

    const options = screen
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual([
      '1 hour',
      '6 hours',
      '12 hours',
      '1 day',
      '3 days'
    ])
  })

  it.each([
    {
      description:
        'moves a selection above the configured range to the nearest offered duration',
      durationInSeconds: 86_400,
      minPollExpirationSeconds: undefined,
      maxPollExpirationSeconds: 3_600,
      expectedDuration: 3_600
    },
    {
      description:
        'moves a selection below the configured range to the nearest offered duration',
      durationInSeconds: 300,
      minPollExpirationSeconds: 43_200,
      maxPollExpirationSeconds: undefined,
      expectedDuration: 43_200
    }
  ])(
    '$description',
    ({
      durationInSeconds,
      minPollExpirationSeconds,
      maxPollExpirationSeconds,
      expectedDuration
    }) => {
      const onChooseDuration = vi.fn()
      renderPollChoices({
        durationInSeconds,
        minPollExpirationSeconds,
        maxPollExpirationSeconds,
        onChooseDuration
      })

      expect(onChooseDuration).toHaveBeenCalledWith(expectedDuration)
    }
  )

  it('leaves an in-range selection alone', () => {
    const onChooseDuration = vi.fn()
    renderPollChoices({ durationInSeconds: 86_400, onChooseDuration })

    expect(onChooseDuration).not.toHaveBeenCalled()
  })

  it('keeps every duration when the configured range excludes them all', () => {
    // An admin can configure a range with no labelled duration in it through
    // the API; the picker degrades rather than rendering empty.
    renderPollChoices({
      minPollExpirationSeconds: 700_000,
      maxPollExpirationSeconds: 800_000
    })

    expect(screen.getAllByRole('option')).toHaveLength(8)
  })
})
