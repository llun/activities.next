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

  it('moves a selected duration that falls outside the configured range', () => {
    const onChooseDuration = vi.fn()
    renderPollChoices({
      // The built-in default (1 day) is above this instance's maximum.
      durationInSeconds: 86_400,
      maxPollExpirationSeconds: 3_600,
      onChooseDuration
    })

    expect(onChooseDuration).toHaveBeenCalledWith(300)
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
