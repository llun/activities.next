/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'

import { searchGalleryTaxa, updateMediaDetails } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import {
  SUGGESTIONS,
  emptyDetails,
  gears,
  getGalleryGearsMock,
  getMediaMock,
  makeItem,
  renderDialog,
  retryMediaLookupsMock,
  settings,
  suggestMediaSubjectsMock,
  updateMediaDetailsMock,
  withSuggestions
} from './media-details-dialog.helpers'

vi.mock('@/lib/client', () => ({
  addGalleryAlbumItems: vi.fn(),
  getMediaAlbums: vi.fn(),
  removeGalleryAlbumItems: vi.fn(),
  createGalleryGear: vi.fn(),
  describeMedia: vi.fn(),
  getGalleryGears: vi.fn(),
  getMedia: vi.fn(),
  retryMediaLookups: vi.fn(),
  searchGalleryTaxa: vi.fn(),
  suggestMediaSubjects: vi.fn(),
  updateMediaDetails: vi.fn(),
  TaxaSearchUnavailableError: class extends Error {}
}))

describe('MediaDetailsDialog smart subjects', () => {
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    vi.clearAllMocks()
    getGalleryGearsMock.mockResolvedValue(gears)
    // A lookup under way makes the dialog read the media again; by default
    // that read never answers.
    getMediaMock.mockImplementation(() => new Promise(() => {}))
    updateMediaDetailsMock.mockImplementation(
      async (id) =>
        ({ id, description: null }) as unknown as Awaited<
          ReturnType<typeof updateMediaDetails>
        >
    )
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  it('offers the candidates at or above the threshold and the group', () => {
    renderDialog([withSuggestions()])

    expect(
      screen.getByText('Suggested by test-vision-model · checked against GBIF')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Warbling White-eye 81%' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Swinhoe/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Just “Bird”' })
    ).toBeInTheDocument()
  })

  it('does not claim a GBIF check when the suggestions were not checked', () => {
    renderDialog([withSuggestions({ ...SUGGESTIONS, checkedAgainst: null })])

    expect(
      screen.getByText('Suggested by test-vision-model')
    ).toBeInTheDocument()
    expect(screen.queryByText(/checked against GBIF/)).not.toBeInTheDocument()
  })

  it('moves the threshold with the setting', () => {
    renderDialog([withSuggestions()], {
      settings: settings({ subjectConfidenceThreshold: 10 })
    })

    expect(
      screen.getByRole('button', { name: 'Swinhoe’s White-eye 12%' })
    ).toBeInTheDocument()
  })

  it('offers only the group guess when no candidate is confident enough', () => {
    renderDialog([withSuggestions()], {
      settings: settings({ subjectConfidenceThreshold: 90 })
    })

    expect(
      screen.queryByRole('button', { name: /Warbling White-eye/ })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bird?' })).toBeInTheDocument()
  })

  it('fills the draft from a candidate and saves only on Save', async () => {
    const { onSaved } = renderDialog([withSuggestions()])

    const chip = screen.getByRole('button', { name: 'Warbling White-eye 81%' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Name')).toHaveValue('Warbling White-eye')
    expect(screen.getByLabelText('Scientific name')).toHaveValue(
      'Zosterops japonicus'
    )
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            'Zosterops japonicus · Animalia › Chordata › Aves › Passeriformes › Zosteropidae'
      )
    ).toBeInTheDocument()
    expect(updateMediaDetailsMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('m1', {
      subject_name: 'Warbling White-eye',
      subject_scientific_name: 'Zosterops japonicus',
      subject_category: 'bird',
      subject_taxon_key: '5232437'
    })
  })

  it('picks the group alone, with no species or taxon', async () => {
    renderDialog([withSuggestions()])

    fireEvent.click(screen.getByRole('button', { name: 'Just “Bird”' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(updateMediaDetailsMock).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('m1', {
      subject_name: 'Bird',
      subject_category: 'bird'
    })
  })

  it('drops the matched taxon when the scientific name is edited by hand', async () => {
    renderDialog([withSuggestions()])
    fireEvent.click(
      screen.getByRole('button', { name: 'Warbling White-eye 81%' })
    )

    fireEvent.change(screen.getByLabelText('Scientific name'), {
      target: { value: 'Zosterops palpebrosus' }
    })

    expect(screen.queryByText(/Zosteropidae/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(updateMediaDetailsMock).toHaveBeenCalled())
    expect(updateMediaDetailsMock.mock.calls[0][1]).not.toHaveProperty(
      'subject_taxon_key'
    )
  })

  it('keeps the manual inputs under Edit manually', () => {
    renderDialog([withSuggestions()])

    const toggle = screen.getByRole('button', { name: 'Edit manually' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Name')).not.toBeVisible()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Name')).toBeVisible()
  })

  it('shows the manual inputs and no suggestion controls when the server offers neither', () => {
    renderDialog([withSuggestions()], {
      settings: settings({
        subjectSuggestionsAvailable: false,
        speciesLookupsAvailable: false
      })
    })

    expect(screen.getByLabelText('Name')).toBeVisible()
    expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Search subjects/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit manually' })
    ).not.toBeInTheDocument()
  })

  it('hides stored suggestions when the author turned suggestions off', () => {
    renderDialog([withSuggestions()], {
      settings: settings({ subjectSuggestionMode: 'off' })
    })

    expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Suggest subjects' })
    ).not.toBeInTheDocument()
  })

  it('asks for suggestions on request and shares them with the composer', async () => {
    suggestMediaSubjectsMock.mockResolvedValue(SUGGESTIONS)
    const { onDetailsRefreshed } = renderDialog([withSuggestions(null)])

    fireEvent.click(screen.getByRole('button', { name: 'Suggest subjects' }))

    expect(
      await screen.findByRole('button', { name: 'Warbling White-eye 81%' })
    ).toBeInTheDocument()
    expect(suggestMediaSubjectsMock).toHaveBeenCalledWith('m1')
    expect(onDetailsRefreshed).toHaveBeenCalledWith(
      'm1',
      { subjectSuggestions: SUGGESTIONS },
      expect.objectContaining({ subjectSuggestions: SUGGESTIONS })
    )
  })

  it('reports a failed suggestion request', async () => {
    suggestMediaSubjectsMock.mockRejectedValue(
      new Error('Subject suggestions are not configured')
    )
    renderDialog([withSuggestions(null)])

    fireEvent.click(screen.getByRole('button', { name: 'Suggest subjects' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Subject suggestions are not configured'
    )
  })

  it('keeps a late suggestion error on the photo that asked', async () => {
    const suggestion = createDeferred<typeof SUGGESTIONS>()
    suggestMediaSubjectsMock.mockReturnValue(suggestion.promise)
    renderDialog([withSuggestions(null), makeItem('m2')])

    fireEvent.click(screen.getByRole('button', { name: 'Suggest subjects' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next item' }))
    await act(async () => {
      suggestion.reject(new Error('Subject suggestions are not configured'))
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous item' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Subject suggestions are not configured'
    )
  })

  it('says it is reading while the composer is still asking', () => {
    renderDialog([withSuggestions(null)], {
      suggestionsPending: { m1: true }
    })

    expect(screen.getByRole('status')).toHaveTextContent('Reading details')
    expect(
      screen.queryByRole('button', { name: 'Suggest subjects' })
    ).not.toBeInTheDocument()
  })

  it('opens the species picker from Search subjects', () => {
    renderDialog([withSuggestions()])

    fireEvent.click(screen.getByRole('button', { name: /Search subjects/ }))

    expect(
      screen.getByRole('dialog', { name: 'What’s in this photo?' })
    ).toBeInTheDocument()
  })

  it('applies the picker’s choice to the draft', async () => {
    renderDialog([withSuggestions()])
    fireEvent.click(screen.getByRole('button', { name: /Search subjects/ }))

    fireEvent.click(
      screen.getByRole('button', { name: 'Use Warbling White-eye' })
    )

    expect(
      screen.queryByRole('dialog', { name: 'What’s in this photo?' })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Warbling White-eye')
  })

  it('applies the picker’s choice to every item when asked', async () => {
    renderDialog([withSuggestions(), makeItem('m2')])
    fireEvent.click(screen.getByRole('button', { name: /Search subjects/ }))

    fireEvent.click(screen.getByRole('switch', { name: /every shot/ }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Use Warbling White-eye' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(updateMediaDetailsMock).toHaveBeenCalledTimes(2))
    expect(updateMediaDetailsMock).toHaveBeenCalledWith(
      'm2',
      expect.objectContaining({ subject_name: 'Warbling White-eye' })
    )
  })

  it('shows a subject picked from the search as a selected chip', async () => {
    vi.mocked(searchGalleryTaxa).mockResolvedValue([])
    renderDialog([withSuggestions()])
    fireEvent.click(screen.getByRole('button', { name: /Search subjects/ }))

    fireEvent.change(screen.getByLabelText('Search species'), {
      target: { value: 'sunset' }
    })
    fireEvent.click(await screen.findByRole('radio', { name: /Use “sunset”/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use sunset' }))

    // Visible text, not only the collapsed Name field's value.
    const chosen = screen.getByRole('group', { name: 'Chosen subject' })
    expect(chosen).toHaveTextContent('sunset')
    expect(chosen).toBeVisible()
  })

  it('shows a saved subject when there are no suggestions, and clears it', () => {
    renderDialog([
      withSuggestions(null, {
        subject: {
          name: 'Common Kingfisher',
          scientificName: 'Alcedo atthis',
          category: 'bird',
          taxonKey: '2475532',
          taxonPath: [],
          iucnCategory: 'LC',
          threatStatus: 'not-threatened',
          lookupStatus: 'resolved',
          lookupAt: null,
          lookupStale: false
        }
      })
    ])

    const chosen = screen.getByRole('group', { name: 'Chosen subject' })
    expect(chosen).toHaveTextContent('Common Kingfisher')
    expect(chosen).toHaveTextContent('Alcedo atthis')

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear subject Common Kingfisher' })
    )

    expect(
      screen.queryByRole('group', { name: 'Chosen subject' })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('does not repeat a subject a suggestion chip already shows', () => {
    renderDialog([withSuggestions()])

    fireEvent.click(
      screen.getByRole('button', { name: 'Warbling White-eye 81%' })
    )

    expect(
      screen.getByRole('button', { name: 'Warbling White-eye 81%' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.queryByRole('group', { name: 'Chosen subject' })
    ).not.toBeInTheDocument()
  })

  it('un-picks a chosen suggestion chip when it is pressed again', () => {
    renderDialog([withSuggestions()])
    const chip = screen.getByRole('button', { name: 'Warbling White-eye 81%' })

    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Edit manually' }))
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Scientific name')).toHaveValue('')
  })

  // The race: a slow suggestion used to publish the details captured when
  // Suggest was clicked, putting back the status a Retry had just replaced.
  it('merges a slow suggestion into the details a retry refreshed meanwhile', async () => {
    const slowSuggestion = createDeferred<typeof SUGGESTIONS>()
    suggestMediaSubjectsMock.mockReturnValue(slowSuggestion.promise)
    const failedSubject = {
      name: 'Bengal Tiger',
      scientificName: 'Panthera tigris',
      category: 'mammal' as const,
      taxonKey: null,
      taxonPath: null,
      iucnCategory: null,
      threatStatus: 'unchecked' as const,
      lookupStatus: 'failed' as const,
      lookupAt: null,
      lookupStale: false
    }
    retryMediaLookupsMock.mockResolvedValue({
      ...emptyDetails,
      subject: {
        ...failedSubject,
        iucnCategory: 'EN',
        threatStatus: 'threatened',
        lookupStatus: 'resolved'
      }
    })
    const { onDetailsRefreshed } = renderDialog([
      withSuggestions(null, { subject: failedSubject })
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Suggest subjects' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/Endangered \(EN\)/)).toBeInTheDocument()

    slowSuggestion.resolve(SUGGESTIONS)

    expect(
      await screen.findByRole('button', { name: 'Warbling White-eye 81%' })
    ).toBeInTheDocument()
    // The retry's status stays.
    expect(screen.getByText(/Endangered \(EN\)/)).toBeInTheDocument()
    expect(
      screen.queryByText(/couldn’t confirm the species/)
    ).not.toBeInTheDocument()
    // The composer is handed only the suggestions to merge.
    expect(onDetailsRefreshed).toHaveBeenLastCalledWith(
      'm1',
      { subjectSuggestions: SUGGESTIONS },
      expect.any(Object)
    )
  })
})
