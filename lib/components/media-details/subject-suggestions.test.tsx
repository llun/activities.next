/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { SubjectSuggestionsEntity } from '@/lib/client'

import { draftFromDetails } from './mediaDetailsDraft'
import { SubjectSuggestions } from './subject-suggestions'

const candidate = (
  name: string,
  overrides: Partial<SubjectSuggestionsEntity['candidates'][number]> = {}
): SubjectSuggestionsEntity['candidates'][number] => ({
  name,
  scientificName: null,
  category: 'bird',
  confidence: 0.8,
  taxonKey: null,
  rank: null,
  taxonPath: [],
  ...overrides
})

const SUGGESTIONS: SubjectSuggestionsEntity = {
  model: 'test-vision-model',
  generatedAt: '2026-10-08T10:00:00.000Z',
  checkedAgainst: 'gbif',
  candidates: [candidate('Warbling White-eye')],
  group: 'bird'
}

const renderSuggestions = (suggestions: SubjectSuggestionsEntity) =>
  render(
    <SubjectSuggestions
      suggestions={suggestions}
      threshold={50}
      draft={draftFromDetails('', false, null)}
      canSuggest
      suggesting={false}
      error={null}
      canSearch={false}
      onPick={vi.fn()}
      onSuggest={vi.fn()}
      onSearch={vi.fn()}
    />
  )

const caption = () => screen.getByText(/^Suggested by/).closest('p')!

describe('SubjectSuggestions place context', () => {
  it.each([
    [{ countryCode: 'JP', month: 5 }, 'for Japan in May'],
    [{ countryCode: 'JP', month: null }, 'for Japan'],
    [{ countryCode: null, month: 5 }, 'in May']
  ])('appends the place and month to the caption (%o)', (context, text) => {
    renderSuggestions({ ...SUGGESTIONS, context })

    expect(caption()).toHaveTextContent(
      `Suggested by test-vision-model · checked against GBIF·${text}`
    )
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it.each([
    ['no context', undefined],
    ['an empty context', { countryCode: null, month: null }]
  ])('shows today’s caption with %s', (_, context) => {
    renderSuggestions({ ...SUGGESTIONS, context })

    expect(caption().textContent).toBe(
      'Suggested by test-vision-model · checked against GBIF'
    )
  })

  it('tags a species with no records in the country as rare here', () => {
    renderSuggestions({
      ...SUGGESTIONS,
      context: { countryCode: 'JP', month: 5 },
      candidates: [
        candidate('Japanese White-eye', { recordedInCountry: true }),
        candidate('Swinhoe’s White-eye', { recordedInCountry: null }),
        candidate('Cape White-eye', {
          confidence: 0.6,
          recordedInCountry: false
        })
      ]
    })

    expect(
      screen.getByRole('button', { name: 'Cape White-eye 60% rare here' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Japanese White-eye 80%' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Swinhoe’s White-eye 80%' })
    ).toBeInTheDocument()
    expect(screen.getAllByText('rare here')).toHaveLength(1)
    expect(screen.getByText('rare here')).toHaveClass('text-warning-text')
  })
})
