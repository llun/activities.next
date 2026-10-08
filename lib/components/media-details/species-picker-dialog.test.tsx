/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  GalleryTaxonEntity,
  SubjectSuggestionsEntity,
  TaxaSearchUnavailableError,
  searchGalleryTaxa
} from '@/lib/client'

import { SpeciesPickerDialog } from './species-picker-dialog'

vi.mock('@/lib/client', () => ({
  searchGalleryTaxa: vi.fn(),
  TaxaSearchUnavailableError: class extends Error {}
}))

const searchMock = vi.mocked(searchGalleryTaxa)

const SUGGESTIONS: SubjectSuggestionsEntity = {
  model: 'vision',
  generatedAt: '2026-10-08T10:00:00.000Z',
  checkedAgainst: 'gbif',
  candidates: [
    {
      name: 'Warbling White-eye',
      scientificName: 'Zosterops japonicus',
      category: 'bird',
      confidence: 0.81,
      taxonKey: '5232437',
      rank: 'SPECIES',
      taxonPath: [
        'Animalia',
        'Chordata',
        'Aves',
        'Passeriformes',
        'Zosteropidae'
      ]
    },
    {
      name: 'Swinhoe’s White-eye',
      scientificName: 'Zosterops simplex',
      category: 'bird',
      confidence: 0.12,
      taxonKey: '5232440',
      rank: 'SPECIES',
      taxonPath: ['Animalia', 'Chordata', 'Aves']
    }
  ],
  group: 'bird'
}

const TAXON: GalleryTaxonEntity = {
  taxonKey: '2480826',
  scientificName: 'Ardea cinerea',
  vernacularName: 'Grey Heron',
  rank: 'SPECIES',
  category: 'bird',
  taxonPath: ['Animalia', 'Chordata', 'Aves', 'Pelecaniformes', 'Ardeidae']
}

const renderPicker = (
  props: Partial<Parameters<typeof SpeciesPickerDialog>[0]> = {}
) => {
  const onCancel = vi.fn()
  const onUse = vi.fn()
  render(
    <SpeciesPickerDialog
      photo={{ url: 'https://activities.local/files/m1.jpg', alt: 'A bird' }}
      position={{ index: 1, total: 4 }}
      suggestions={SUGGESTIONS}
      onCancel={onCancel}
      onUse={onUse}
      {...props}
    />
  )
  return { onCancel, onUse }
}

describe('SpeciesPickerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchMock.mockResolvedValue([TAXON])
  })

  it('shows the photo, its position and the guidance copy', () => {
    renderPicker()

    expect(
      screen.getByRole('dialog', { name: 'What’s in this photo?' })
    ).toBeInTheDocument()
    expect(screen.getByAltText('A bird')).toBeInTheDocument()
    expect(screen.getByText('Photo 2 of 4')).toBeInTheDocument()
    expect(
      screen.getByText(/Your choice is what gets posted/)
    ).toBeInTheDocument()
    expect(
      screen.getByText('Names from the GBIF Backbone Taxonomy')
    ).toBeInTheDocument()
  })

  it('lists the best matches with their percentages and starts on the likeliest', () => {
    renderPicker()

    const best = screen.getByRole('group', { name: 'Best matches' })
    expect(best).toHaveTextContent('Warbling White-eye')
    expect(best).toHaveTextContent('81% match')
    expect(best).toHaveTextContent('12% match')
    expect(
      screen.getByRole('radio', { name: /Warbling White-eye/ })
    ).toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Use Warbling White-eye' })
    ).toBeEnabled()
  })

  it('shows the taxonomy of the selection, ending in the scientific name', () => {
    renderPicker()

    const nav = screen.getByRole('navigation', { name: 'Taxonomy' })
    expect(nav).toHaveTextContent(
      'Animalia›Chordata›Aves›Passeriformes›Zosteropidae›Zosterops japonicus'
    )

    fireEvent.click(screen.getByRole('radio', { name: /Swinhoe/ }))

    expect(nav).toHaveTextContent('Animalia›Chordata›Aves›Zosterops simplex')
  })

  it('uses the chosen candidate', () => {
    const { onUse } = renderPicker()

    fireEvent.click(screen.getByRole('radio', { name: /Swinhoe/ }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Use Swinhoe’s White-eye' })
    )

    expect(onUse).toHaveBeenCalledWith(
      {
        name: 'Swinhoe’s White-eye',
        scientificName: 'Zosterops simplex',
        category: 'bird',
        taxonKey: '5232440',
        taxonPath: ['Animalia', 'Chordata', 'Aves']
      },
      false
    )
  })

  it('offers the genus alone when the species is uncertain', () => {
    const { onUse } = renderPicker()

    const group = screen.getByRole('radio', { name: /Just “Zosterops”/ })
    expect(
      screen.getByText('Not sure of the species? Tag the genus only.')
    ).toBeInTheDocument()
    fireEvent.click(group)
    fireEvent.click(screen.getByRole('button', { name: 'Use Zosterops' }))

    expect(onUse).toHaveBeenCalledWith(
      {
        name: 'Zosterops',
        scientificName: 'Zosterops',
        category: 'bird',
        taxonKey: '',
        taxonPath: SUGGESTIONS.candidates[0].taxonPath
      },
      false
    )
  })

  it('searches after a pause and lists the results', async () => {
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search species'), {
      target: { value: '  heron ' }
    })

    expect(
      await screen.findByRole('radio', { name: /Grey Heron/ })
    ).toBeInTheDocument()
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock).toHaveBeenCalledWith('heron', {
      signal: expect.any(AbortSignal)
    })
    expect(
      screen.getByRole('group', { name: 'Search results' })
    ).toHaveTextContent('Ardea cinerea')
  })

  it('does not search for a single character', async () => {
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search species'), {
      target: { value: 'h' }
    })
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(searchMock).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('group', { name: 'Search results' })
    ).not.toBeInTheDocument()
  })

  it('uses a search result with its taxon and path', async () => {
    const { onUse } = renderPicker({ suggestions: null })

    fireEvent.change(screen.getByLabelText('Search species'), {
      target: { value: 'heron' }
    })
    fireEvent.click(await screen.findByRole('radio', { name: /Grey Heron/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use Grey Heron' }))

    expect(onUse).toHaveBeenCalledWith(
      {
        name: 'Grey Heron',
        scientificName: 'Ardea cinerea',
        category: 'bird',
        taxonKey: '2480826',
        taxonPath: TAXON.taxonPath
      },
      false
    )
  })

  it('names a search result by its scientific name when it has no common name', async () => {
    searchMock.mockResolvedValue([{ ...TAXON, vernacularName: null }])
    renderPicker({ suggestions: null })

    fireEvent.change(screen.getByLabelText('Search species'), {
      target: { value: 'ardea' }
    })

    expect(
      await screen.findByRole('radio', { name: /Ardea cinerea/ })
    ).toBeInTheDocument()
  })

  it('offers the typed words as the subject when it is not a species', async () => {
    searchMock.mockResolvedValue([])
    const { onUse } = renderPicker({ suggestions: null })

    fireEvent.change(screen.getByLabelText('Search species'), {
      target: { value: 'sunset' }
    })
    expect(
      await screen.findByText('No species found for “sunset”.')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Use “sunset”/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use sunset' }))

    expect(onUse).toHaveBeenCalledWith(
      {
        name: 'sunset',
        scientificName: '',
        category: '',
        taxonKey: '',
        taxonPath: []
      },
      false
    )
  })

  it('says species search is not available when the server cannot search', async () => {
    searchMock.mockRejectedValue(new TaxaSearchUnavailableError())
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search species'), {
      target: { value: 'heron' }
    })

    expect(
      await screen.findByText(/Species search isn’t available/)
    ).toBeInTheDocument()
    // The candidates still work.
    expect(
      screen.getByRole('button', { name: 'Use Warbling White-eye' })
    ).toBeEnabled()
  })

  it('reports any other search failure', async () => {
    searchMock.mockRejectedValue(new Error('boom'))
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search species'), {
      target: { value: 'heron' }
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Species could not be searched'
    )
  })

  it('hands the every-shot switch to the caller', () => {
    const { onUse } = renderPicker()

    const toggle = screen.getByRole('switch', {
      name: /Use for every shot of this bird in the post/
    })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    fireEvent.click(
      screen.getByRole('button', { name: 'Use Warbling White-eye' })
    )

    expect(onUse).toHaveBeenCalledWith(expect.any(Object), true)
  })

  it('leaves the every-shot switch out for a single photo', () => {
    renderPicker({ position: { index: 0, total: 1 } })

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('cannot use anything before a choice is made', () => {
    renderPicker({ suggestions: null })

    expect(screen.getByRole('button', { name: 'Use' })).toBeDisabled()
  })

  it('cancels from the buttons', () => {
    const { onCancel } = renderPicker()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('keeps a slow search from overwriting a newer one', async () => {
    let resolveFirst: (taxa: GalleryTaxonEntity[]) => void = () => {}
    searchMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve))
    )
    searchMock.mockResolvedValueOnce([{ ...TAXON, vernacularName: 'Newer' }])
    renderPicker({ suggestions: null })
    const search = screen.getByLabelText('Search species')

    fireEvent.change(search, { target: { value: 'first' } })
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1))
    fireEvent.change(search, { target: { value: 'second' } })
    await screen.findByRole('radio', { name: /Newer/ })
    resolveFirst([{ ...TAXON, vernacularName: 'Older' }])
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(
      screen.queryByRole('radio', { name: /Older/ })
    ).not.toBeInTheDocument()
  })
})
