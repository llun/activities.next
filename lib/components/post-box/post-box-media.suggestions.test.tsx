/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { screen, waitFor } from '@testing-library/react'

import { createDeferred } from '@/lib/testing/deferred'

import {
  attach,
  getGallerySettingsMock,
  getMediaMock,
  mediaEntity,
  renderPostBox,
  resetPostBoxMediaMocks,
  settings,
  suggestMock
} from './post-box-media.testUtils'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  deleteAccountMedia: vi.fn().mockResolvedValue(true),
  createPoll: vi.fn(),
  deleteFitnessFile: vi.fn(),
  describeMedia: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGalleryGears: vi.fn(),
  getGallerySettings: vi.fn(),
  getMedia: vi.fn(),
  getMediaAlbums: vi.fn(),
  suggestMediaSubjects: vi.fn(),
  updateMediaDetails: vi.fn(),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

vi.mock('@/lib/utils/extractVideoPoster', () => ({
  extractVideoPoster: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

describe('PostBox media details', () => {
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    resetPostBoxMediaMocks()
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  describe('subject suggestions', () => {
    const SUGGESTIONS = {
      model: 'vision',
      generatedAt: '2026-10-08T10:00:00.000Z',
      checkedAgainst: 'gbif' as const,
      candidates: [
        {
          name: 'Warbling White-eye',
          scientificName: 'Zosterops japonicus',
          category: 'bird' as const,
          confidence: 0.81,
          taxonKey: '5232437',
          rank: 'SPECIES',
          taxonPath: ['Animalia']
        }
      ],
      group: 'bird' as const
    }

    beforeEach(() => {
      getGallerySettingsMock.mockResolvedValue(
        settings({
          subjectSuggestionsAvailable: true,
          subjectSuggestionMode: 'model',
          subjectConfidenceThreshold: 70
        })
      )
      getMediaMock.mockImplementation(async (id) =>
        mediaEntity(id, 'A bird', { subjectSuggestions: null })
      )
      suggestMock.mockResolvedValue(SUGGESTIONS)
    })

    it('asks for suggestions after the upload and shows the best guess for review', async () => {
      renderPostBox()

      attach('bird.png')

      expect(await screen.findByText('Warbling White-eye')).toBeInTheDocument()
      expect(screen.getByText('Suggested:')).toBeInTheDocument()
      expect(screen.getByText('Review')).toBeInTheDocument()
      expect(suggestMock).toHaveBeenCalledWith('media-bird.png')
    })

    it('says it is reading details while a suggestion is in flight, and stays openable', async () => {
      const pending = createDeferred<typeof SUGGESTIONS>()
      suggestMock.mockReturnValueOnce(pending.promise)
      renderPostBox()

      attach('bird.png')

      expect(await screen.findByText('Reading details…')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /details of bird\.png/ })
      ).toBeEnabled()

      pending.resolve(SUGGESTIONS)

      await waitFor(() =>
        expect(screen.queryByText('Reading details…')).not.toBeInTheDocument()
      )
    })

    it('shows only the group guess when no species is confident enough', async () => {
      getGallerySettingsMock.mockResolvedValue(
        settings({
          subjectSuggestionsAvailable: true,
          subjectSuggestionMode: 'model',
          subjectConfidenceThreshold: 90
        })
      )
      renderPostBox()

      attach('bird.png')

      expect(await screen.findByText('Bird?')).toBeInTheDocument()
    })

    it('shows the confirmed subject instead of a suggestion', async () => {
      getMediaMock.mockResolvedValue(
        mediaEntity('media-bird.png', 'A bird', {
          subject: {
            name: 'Common Kingfisher',
            scientificName: null,
            category: 'bird'
          },
          subjectSuggestions: SUGGESTIONS
        })
      )
      renderPostBox()

      attach('bird.png')

      expect(await screen.findByText('Common Kingfisher')).toBeInTheDocument()
      expect(screen.queryByText('Suggested:')).not.toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
    })

    it('shows a saved scientific name, in italics, instead of a suggestion', async () => {
      getMediaMock.mockResolvedValue(
        mediaEntity('media-bird.png', 'A bird', {
          subject: {
            name: null,
            scientificName: 'Alcedo atthis',
            category: 'bird'
          },
          subjectSuggestions: SUGGESTIONS
        })
      )
      renderPostBox()

      attach('bird.png')

      const name = await screen.findByText('Alcedo atthis')
      expect(name.tagName).toBe('I')
      expect(screen.queryByText('Suggested:')).not.toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
    })

    it('offers no suggestion over a saved subject with only a category', async () => {
      getMediaMock.mockResolvedValue(
        mediaEntity('media-bird.png', 'A bird', {
          subject: { name: null, scientificName: null, category: 'bird' },
          subjectSuggestions: SUGGESTIONS
        })
      )
      renderPostBox()

      attach('bird.png')

      expect(await screen.findByText('Edit')).toBeInTheDocument()
      expect(screen.queryByText('Suggested:')).not.toBeInTheDocument()
      expect(screen.queryByText('Warbling White-eye')).not.toBeInTheDocument()
    })

    it.each([
      ['the server has no model', { subjectSuggestionsAvailable: false }],
      ['the author turned suggestions off', { subjectSuggestionMode: 'off' }]
    ])('makes no request when %s', async (_, overrides) => {
      getGallerySettingsMock.mockResolvedValue(
        settings({
          subjectSuggestionsAvailable: true,
          subjectSuggestionMode: 'model',
          ...overrides
        })
      )
      renderPostBox()

      attach('bird.png')

      await screen.findByText('Edit')
      expect(suggestMock).not.toHaveBeenCalled()
      expect(screen.queryByText('Suggested:')).not.toBeInTheDocument()
    })

    it.each([
      ['the server has no model', { subjectSuggestionsAvailable: false }],
      ['the author turned suggestions off', { subjectSuggestionMode: 'off' }]
    ])(
      'ignores suggestions already stored on the media when %s',
      async (_, overrides) => {
        getGallerySettingsMock.mockResolvedValue(
          settings({
            subjectSuggestionsAvailable: true,
            subjectSuggestionMode: 'model',
            ...overrides
          })
        )
        // A reused media whose details already hold the model's guesses.
        getMediaMock.mockImplementation(async (id) =>
          mediaEntity(id, 'A bird', { subjectSuggestions: SUGGESTIONS })
        )
        renderPostBox()

        attach('bird.png')

        expect(await screen.findByText('Edit')).toBeInTheDocument()
        expect(screen.queryByText('Suggested:')).not.toBeInTheDocument()
        expect(screen.queryByText('Warbling White-eye')).not.toBeInTheDocument()
        expect(screen.queryByText('Review')).not.toBeInTheDocument()
      }
    )

    it('leaves the tile as it was when the request fails', async () => {
      suggestMock.mockRejectedValue(
        new Error('Subjects could not be suggested')
      )
      renderPostBox()

      attach('bird.png')

      await waitFor(() => expect(suggestMock).toHaveBeenCalled())
      await waitFor(() =>
        expect(screen.queryByText('Reading details…')).not.toBeInTheDocument()
      )
      expect(screen.queryByText('Suggested:')).not.toBeInTheDocument()
      expect(screen.getByText('Edit')).toBeInTheDocument()
    })

    it('runs at most two requests at once', async () => {
      const gates = Array.from({ length: 3 }, () =>
        createDeferred<typeof SUGGESTIONS>()
      )
      let next = 0
      suggestMock.mockImplementation(() => gates[next++].promise)
      renderPostBox()

      attach('a.png', 'b.png', 'c.png')

      await waitFor(() => expect(suggestMock).toHaveBeenCalledTimes(2))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(suggestMock).toHaveBeenCalledTimes(2)

      gates[0].resolve(SUGGESTIONS)

      await waitFor(() => expect(suggestMock).toHaveBeenCalledTimes(3))
      gates[1].resolve(SUGGESTIONS)
      gates[2].resolve(SUGGESTIONS)
    })
  })
})
