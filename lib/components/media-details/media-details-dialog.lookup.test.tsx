/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'

import { getMedia, updateMediaDetails } from '@/lib/client'
import {
  STALE_PLACE_LOOKUP_MS,
  STALE_SUBJECT_LOOKUP_MS
} from '@/lib/services/medias/lookupStaleness'
import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import { createDeferred } from '@/lib/testing/deferred'

import {
  emptyDetails,
  gears,
  getGalleryGearsMock,
  getMediaMock,
  makeItem,
  renderDialog,
  retryMediaLookupsMock,
  settings,
  updateMediaDetailsMock
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

  describe('lookup status', () => {
    const subject = (
      overrides: Partial<NonNullable<MediaDetailsEntity['subject']>>
    ): MediaDetailsEntity => ({
      ...emptyDetails,
      subject: {
        name: 'Bengal Tiger',
        scientificName: 'Panthera tigris',
        category: 'mammal',
        taxonKey: '5219416',
        taxonPath: ['Animalia'],
        iucnCategory: null,
        threatStatus: 'unchecked',
        lookupStatus: null,
        lookupAt: null,
        lookupStale: false,
        ...overrides
      }
    })

    it('shows the IUCN status and that a threatened place is hidden', () => {
      renderDialog([
        makeItem('m1', {
          details: subject({
            iucnCategory: 'EN',
            threatStatus: 'threatened',
            lookupStatus: 'resolved'
          })
        })
      ])

      expect(
        screen.getByText(/Endangered \(EN\) · IUCN Red List status via GBIF/)
      ).toBeInTheDocument()
      expect(
        screen.getByText(/the place is hidden from other people/)
      ).toBeInTheDocument()
    })

    it('does not say the place is hidden when the author turned that off', () => {
      renderDialog(
        [
          makeItem('m1', {
            details: subject({
              iucnCategory: 'EN',
              threatStatus: 'threatened',
              lookupStatus: 'resolved'
            })
          })
        ],
        { settings: settings({ hideThreatenedPlaces: false }) }
      )

      expect(screen.queryByText(/place is hidden/)).not.toBeInTheDocument()
    })

    it('offers Retry when the check failed and shows the refreshed status', async () => {
      retryMediaLookupsMock.mockResolvedValue(
        subject({ lookupStatus: 'pending' })
      )
      const { onDetailsRefreshed } = renderDialog([
        makeItem('m1', { details: subject({ lookupStatus: 'failed' }) })
      ])
      expect(
        screen.getByText(/couldn’t confirm the species/)
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      expect(
        await screen.findByText('Checking IUCN status…')
      ).toBeInTheDocument()
      expect(retryMediaLookupsMock).toHaveBeenCalledWith('m1', {
        kind: 'subject'
      })
      expect(onDetailsRefreshed).toHaveBeenCalled()
    })

    describe('reading again while a lookup is pending (fake timers)', () => {
      const NOW = Date.parse('2026-10-08T12:00:00.000Z')
      const at = (ms: number) => new Date(ms).toISOString()
      const pending = (lookupAt: number) =>
        subject({ lookupStatus: 'pending', lookupAt: at(lookupAt) })
      const answer = (details: MediaDetailsEntity) =>
        ({ id: 'm1', details }) as unknown as Awaited<
          ReturnType<typeof getMedia>
        >
      // In steps, so each render's effects (the next read) are scheduled
      // before the clock moves on.
      const advance = async (ms: number) => {
        for (let left = ms; ; left -= 500) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(Math.min(500, Math.max(left, 0)))
          })
          if (left <= 500) break
        }
      }

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        vi.setSystemTime(NOW)
      })
      afterEach(() => {
        vi.useRealTimers()
      })

      it('stops after four reads of the same pending state', async () => {
        getMediaMock.mockResolvedValue(answer(pending(NOW)))
        renderDialog([makeItem('m1', { details: pending(NOW) })])

        await advance(30_000)

        expect(getMediaMock).toHaveBeenCalledTimes(4)
      })

      it('keeps reading after a failed read', async () => {
        getMediaMock
          .mockRejectedValueOnce(new Error('offline'))
          .mockResolvedValue(
            answer(
              subject({
                iucnCategory: 'EN',
                threatStatus: 'threatened',
                lookupStatus: 'resolved',
                lookupAt: at(NOW)
              })
            )
          )
        renderDialog([makeItem('m1', { details: pending(NOW) })])

        await advance(0)
        expect(getMediaMock).toHaveBeenCalledTimes(1)
        await advance(3_000)

        expect(getMediaMock).toHaveBeenCalledTimes(2)
        expect(screen.getByText(/Endangered \(EN\)/)).toBeInTheDocument()
      })

      it('gives a new pending state a fresh budget', async () => {
        // The second read finds the job re-queued, stamped later.
        getMediaMock
          .mockResolvedValueOnce(answer(pending(NOW)))
          .mockResolvedValue(answer(pending(NOW + 5_000)))
        renderDialog([makeItem('m1', { details: pending(NOW) })])

        await advance(60_000)

        // Two reads of the first state (the second finds the new one), then
        // four of the second.
        expect(getMediaMock).toHaveBeenCalledTimes(6)
      })

      it('marks the lookup stale once it is two minutes old, so Retry shows', async () => {
        getMediaMock.mockResolvedValue(answer(pending(NOW)))
        renderDialog([makeItem('m1', { details: pending(NOW) })])

        await advance(STALE_SUBJECT_LOOKUP_MS - 1_000)
        expect(screen.getByText('Checking IUCN status…')).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Retry' })
        ).not.toBeInTheDocument()

        await advance(1_000)
        expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
        expect(getMediaMock).toHaveBeenCalledTimes(4)
      })

      it('marks it stale even when every read failed', async () => {
        getMediaMock.mockRejectedValue(new Error('offline'))
        renderDialog([makeItem('m1', { details: pending(NOW - 60_000) })])

        await advance(STALE_SUBJECT_LOOKUP_MS - 60_000)

        expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
      })

      it('reads again after a Retry, though the earlier budget ran out', async () => {
        getMediaMock.mockResolvedValue(answer(pending(NOW)))
        renderDialog([makeItem('m1', { details: pending(NOW) })])
        await advance(STALE_SUBJECT_LOOKUP_MS)
        expect(getMediaMock).toHaveBeenCalledTimes(4)

        const retried = NOW + STALE_SUBJECT_LOOKUP_MS
        retryMediaLookupsMock.mockResolvedValue(pending(retried))
        getMediaMock.mockResolvedValue(
          answer(
            subject({
              iucnCategory: 'LC',
              threatStatus: 'not-threatened',
              lookupStatus: 'resolved',
              lookupAt: at(retried)
            })
          )
        )
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        await advance(1_000)

        expect(retryMediaLookupsMock).toHaveBeenCalledWith('m1', {
          kind: 'subject'
        })
        expect(getMediaMock).toHaveBeenCalledTimes(5)
        expect(screen.getByText(/Least Concern \(LC\)/)).toBeInTheDocument()
      })

      it('marks a pending place stale too', async () => {
        const pendingPlace: MediaDetailsEntity = {
          ...emptyDetails,
          place: {
            name: null,
            latitude: 14.4,
            longitude: 101.4,
            precision: 'area',
            countryCode: null,
            nameSource: null,
            lookupStatus: 'pending',
            lookupAt: at(NOW),
            lookupStale: false
          }
        }
        getMediaMock.mockResolvedValue(answer(pendingPlace))
        renderDialog([makeItem('m1', { details: pendingPlace })])

        await advance(STALE_PLACE_LOOKUP_MS)

        expect(screen.getByRole('status')).toHaveTextContent(
          'Looking up the place name…'
        )
        expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
      })
    })

    it.each([
      ['failed', { lookupStatus: 'failed' as const }],
      ['an earlier no-match', { lookupStatus: 'no-match' as const }],
      [
        'a genus resolved with no category',
        { lookupStatus: 'resolved' as const, iucnCategory: null }
      ]
    ])(
      'says it couldn’t confirm the species for %s, with the picker',
      (_, overrides) => {
        renderDialog([makeItem('m1', { details: subject(overrides) })])

        expect(
          screen.getByText(
            /We couldn’t confirm the species, so the place stays hidden\./
          )
        ).toHaveTextContent(
          'We couldn’t confirm the species, so the place stays hidden. Pick the species to show it.'
        )
        fireEvent.click(
          screen.getByRole('button', { name: 'Pick the species' })
        )
        expect(
          screen.getByRole('dialog', { name: 'What’s in this photo?' })
        ).toBeInTheDocument()
      }
    )

    it('offers Retry only for a failed check it couldn’t confirm', () => {
      renderDialog([
        makeItem('m1', { details: subject({ lookupStatus: 'no-match' }) })
      ])

      expect(
        screen.getByRole('button', { name: 'Pick the species' })
      ).toBeEnabled()
      expect(
        screen.queryByRole('button', { name: 'Retry' })
      ).not.toBeInTheDocument()
    })

    it('offers no picker while species search is off', () => {
      renderDialog(
        [makeItem('m1', { details: subject({ lookupStatus: 'failed' }) })],
        { settings: settings({ speciesLookupsAvailable: false }) }
      )

      expect(
        screen.getByText(/couldn’t confirm the species/)
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Pick the species' })
      ).not.toBeInTheDocument()
    })

    it.each([
      ['disabled', 'disabled' as const],
      ['never checked', null]
    ])(
      'tells the owner a %s species is unchecked, with Retry',
      (_, lookupStatus) => {
        renderDialog([makeItem('m1', { details: subject({ lookupStatus }) })])

        expect(
          screen.getByText(/Couldn’t check IUCN status/)
        ).toBeInTheDocument()
        expect(
          screen.getByText(/place stays hidden from other people/)
        ).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
      }
    )

    it('offers no Retry while species lookups are off on the server', () => {
      renderDialog(
        [makeItem('m1', { details: subject({ lookupStatus: 'disabled' }) })],
        { settings: settings({ speciesLookupsAvailable: false }) }
      )

      expect(screen.getByText(/Couldn’t check IUCN status/)).toBeInTheDocument()
      expect(
        screen.getByText(/place stays hidden from other people/)
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Retry' })
      ).not.toBeInTheDocument()
    })

    it('does not mention hiding when the author shows threatened places', () => {
      renderDialog(
        [makeItem('m1', { details: subject({ lookupStatus: 'disabled' }) })],
        { settings: settings({ hideThreatenedPlaces: false }) }
      )

      expect(screen.queryByText(/stays hidden/)).not.toBeInTheDocument()
    })

    it('offers Retry only once a pending check has gone stale', () => {
      renderDialog([
        makeItem('m1', {
          details: subject({ lookupStatus: 'pending', lookupStale: false })
        })
      ])
      expect(screen.getByText('Checking IUCN status…')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Retry' })
      ).not.toBeInTheDocument()
    })

    it('offers Retry for a stale pending check', () => {
      renderDialog([
        makeItem('m1', {
          details: subject({ lookupStatus: 'pending', lookupStale: true })
        })
      ])
      expect(screen.getByText('Checking IUCN status…')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    })

    it('hides the status once the draft no longer holds the saved subject', () => {
      renderDialog([
        makeItem('m1', {
          details: subject({ lookupStatus: 'failed' })
        })
      ])

      expect(
        screen.getByText(/couldn’t confirm the species/)
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Edit manually' }))
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Tiger' }
      })

      expect(
        screen.queryByText(/couldn’t confirm the species/)
      ).not.toBeInTheDocument()
    })

    it('hides the IUCN status once only the draft’s category changed', () => {
      renderDialog([
        makeItem('m1', {
          details: subject({
            iucnCategory: 'EN',
            threatStatus: 'threatened',
            lookupStatus: 'resolved'
          })
        })
      ])

      expect(screen.getByText(/Endangered \(EN\)/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Edit manually' }))
      fireEvent.change(screen.getByLabelText('Category'), {
        target: { value: 'plant' }
      })

      expect(screen.queryByText(/Endangered \(EN\)/)).not.toBeInTheDocument()
      expect(screen.queryByText(/place is hidden/)).not.toBeInTheDocument()
    })

    it('reports a failed retry', async () => {
      retryMediaLookupsMock.mockRejectedValue(new Error('Too many requests'))
      renderDialog([
        makeItem('m1', { details: subject({ lookupStatus: 'failed' }) })
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many requests'
      )
    })

    it('keeps a late retry error on the photo that asked', async () => {
      const retry = createDeferred<MediaDetailsEntity>()
      retryMediaLookupsMock.mockReturnValue(retry.promise)
      renderDialog([
        makeItem('m1', { details: subject({ lookupStatus: 'failed' }) }),
        makeItem('m2')
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next item' }))
      await act(async () => {
        retry.reject(new Error('Too many requests'))
      })

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Previous item' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many requests'
      )
    })
  })

  describe('place lookup', () => {
    const place = (
      overrides: Partial<NonNullable<MediaDetailsEntity['place']>>
    ): MediaDetailsEntity => ({
      ...emptyDetails,
      place: {
        name: 'Khao Yai National Park, Thailand',
        latitude: 14.4,
        longitude: 101.4,
        precision: 'area',
        countryCode: 'TH',
        nameSource: 'geocoder',
        lookupStatus: 'resolved',
        lookupAt: null,
        lookupStale: false,
        ...overrides
      }
    })

    it('credits OpenStreetMap beside a place from the file', () => {
      renderDialog([makeItem('m1', { details: place({}) })])

      expect(
        screen.getByText('Place names © OpenStreetMap contributors')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Place name')).toHaveValue(
        'Khao Yai National Park, Thailand'
      )
      expect(screen.getByText('From file')).toBeInTheDocument()
    })

    it('leaves the credit out when place lookups are off', () => {
      renderDialog([makeItem('m1', { details: place({}) })], {
        settings: settings({ placeLookupsAvailable: false })
      })

      expect(screen.queryByText(/OpenStreetMap/)).not.toBeInTheDocument()
    })

    it('offers Retry when the name lookup failed', async () => {
      retryMediaLookupsMock.mockResolvedValue(
        place({ lookupStatus: 'resolved' })
      )
      renderDialog([
        makeItem('m1', {
          details: place({
            name: null,
            nameSource: null,
            lookupStatus: 'failed'
          })
        })
      ])
      expect(
        screen.getByText(/Couldn’t look up the place name/)
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() =>
        expect(retryMediaLookupsMock).toHaveBeenCalledWith('m1', {
          kind: 'place'
        })
      )
      expect(
        await screen.findByDisplayValue('Khao Yai National Park, Thailand')
      ).toBeInTheDocument()
    })

    it('offers Retry for coordinates whose lookup never ran', async () => {
      retryMediaLookupsMock.mockResolvedValue(place({}))
      renderDialog([
        makeItem('m1', {
          details: place({ name: null, nameSource: null, lookupStatus: null })
        })
      ])

      expect(
        screen.getByText(/The place name hasn’t been looked up/)
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      expect(
        await screen.findByDisplayValue('Khao Yai National Park, Thailand')
      ).toBeInTheDocument()
    })

    it('offers no place Retry while place lookups are off on the server', () => {
      renderDialog(
        [
          makeItem('m1', {
            details: place({ name: null, nameSource: null, lookupStatus: null })
          })
        ],
        { settings: settings({ placeLookupsAvailable: false }) }
      )

      expect(
        screen.queryByRole('button', { name: 'Retry' })
      ).not.toBeInTheDocument()
    })

    it('keeps one item’s Retry from busying another’s', async () => {
      retryMediaLookupsMock.mockReturnValue(new Promise(() => {}))
      const failed = place({ lookupStatus: 'failed' })
      renderDialog([
        makeItem('m1', { details: failed }),
        makeItem('m2', { details: failed })
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
      )
      fireEvent.click(screen.getByRole('button', { name: 'Next item' }))

      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    })

    it('says the name is being looked up', () => {
      renderDialog([
        makeItem('m1', {
          details: place({
            name: null,
            nameSource: null,
            lookupStatus: 'pending'
          })
        })
      ])

      expect(screen.getByRole('status')).toHaveTextContent(
        'Looking up the place name…'
      )
      // Queued, not lost: no Retry yet, and no "hasn't been looked up".
      expect(
        screen.queryByRole('button', { name: 'Retry' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(/hasn’t been looked up/)
      ).not.toBeInTheDocument()
    })

    it('offers Retry once the lookup has been pending too long', () => {
      renderDialog([
        makeItem('m1', {
          details: place({
            name: null,
            nameSource: null,
            lookupStatus: 'pending',
            lookupAt: null,
            lookupStale: true
          })
        })
      ])

      expect(screen.getByRole('status')).toHaveTextContent(
        'Looking up the place name…'
      )
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    })

    // The composer holds the details the upload answered with, from before
    // the job ran. The dialog reads the media again, so the geocoded name
    // and "From file" appear without a Retry.
    it('reads a new upload again while its lookup is under way', async () => {
      getMediaMock.mockResolvedValue({
        id: 'm1',
        details: place({})
      } as unknown as Awaited<ReturnType<typeof getMedia>>)
      const { onDetailsRefreshed } = renderDialog([
        makeItem('m1', {
          details: place({
            name: null,
            nameSource: null,
            countryCode: null,
            lookupStatus: 'pending'
          })
        })
      ])

      expect(
        await screen.findByDisplayValue('Khao Yai National Park, Thailand')
      ).toBeInTheDocument()
      expect(getMediaMock).toHaveBeenCalledWith('m1')
      expect(screen.getByText('From file')).toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(retryMediaLookupsMock).not.toHaveBeenCalled()
      expect(onDetailsRefreshed).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({
          place: expect.objectContaining({ lookupStatus: 'resolved' })
        }),
        expect.anything()
      )
    })

    it('does not read the media again when nothing is under way', () => {
      renderDialog([makeItem('m1', { details: place({}) })])

      expect(getMediaMock).not.toHaveBeenCalled()
    })

    it('shows a failed place Retry beside the place, with no subject set', async () => {
      retryMediaLookupsMock.mockRejectedValue(new Error('Too many requests'))
      renderDialog([
        makeItem('m1', {
          details: place({ name: null, lookupStatus: 'failed' })
        })
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many requests'
      )
    })
  })
})
