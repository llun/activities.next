/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

import type { StatusFitnessFileItem } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { mockRefresh } from './FitnessStatusDetail.mocks'
import {
  buildFitnessFile,
  chooseRecording,
  getRecordingRow,
  mockGetFitnessFilesByStatus,
  mockMakeFitnessFilePrimary,
  notMe,
  openRecordingPicker,
  renderDetail,
  resetFitnessStatusDetailMocks
} from './FitnessStatusDetail.testUtils'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessGearList: vi.fn(),
  getFitnessRouteData: vi.fn(),
  makeFitnessFilePrimary: vi.fn(),
  updateFitnessFileGear: vi.fn()
}))

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn()
}))

// The keyless GL loader never resolves here, so the interactive map stays in its
// initializing state (no real MapLibre script is injected in jsdom).
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))

vi.mock('next/navigation', async () => {
  const { mockPush, mockRefresh } = await import('./FitnessStatusDetail.mocks')
  return { useRouter: () => ({ refresh: mockRefresh, push: mockPush }) }
})

vi.mock('@/lib/utils/getStatusDetailPathClient', () => ({
  getStatusDetailPathClient: vi.fn(
    async (status: { id: string }) => `/@actor/${status.id}`
  )
}))

vi.mock('@/lib/components/posts/actor', () => ({
  ActorAvatar: () => <div data-testid="actor-avatar" />
}))

vi.mock('@/lib/components/posts/media', () => ({
  Media: () => <div data-testid="media" />
}))

// The MapKit surface is the one map path that is a component rather than an
// imperative GL handle, so it is where a test can read back the instant the
// page is asking the map to highlight.
vi.mock('@/lib/components/fitness/ActivityRouteMapKit', async () => ({
  ActivityRouteMapKit: (await import('./FitnessStatusDetail.mocks'))
    .MockActivityRouteMapKit
}))

vi.mock('@/lib/components/posts/post', async () => ({
  Post: (await import('./FitnessStatusDetail.mocks')).MockPost
}))

vi.mock('@/lib/components/posts/status-reply-box', () => ({
  StatusReplyBox: () => <div data-testid="comment-composer" />
}))

// Stubbed for the same reason `BrandedDeviceLink` is: this page only has to
// open the shared composer in the right mode against the right status and put
// it in the right place. What each mode renders is
// `lib/components/posts/inline-status-composer.test.tsx`'s job.
vi.mock('@/lib/components/posts/inline-status-composer', async () => ({
  InlineStatusComposer: (await import('./FitnessStatusDetail.mocks'))
    .MockInlineStatusComposer
}))

vi.mock('@/lib/components/posts/actions/reply-button', () => ({
  ReplyButton: ({ onReply }: { onReply?: () => void }) => (
    <button type="button" onClick={() => onReply?.()}>
      Reply
    </button>
  )
}))

vi.mock('@/lib/components/posts/actions/repost-button', () => ({
  RepostButton: () => <button type="button">Boost</button>
}))

vi.mock('@/lib/components/posts/actions/like-button', () => ({
  LikeButton: () => <button type="button">Like</button>
}))

vi.mock('@/lib/components/posts/actions/bookmark-button', () => ({
  BookmarkButton: () => <button type="button">Bookmark</button>
}))

// Flattened rather than driven as a real Radix menu; see MockPostMenu.
vi.mock('@/lib/components/posts/actions/post-menu', async () => ({
  PostMenu: (await import('./FitnessStatusDetail.mocks')).MockPostMenu
}))

// Stubbed rather than rendered: this page only has to forward the right props
// to it. Where each of the three renderings actually goes is asserted in
// `lib/components/posts/BrandedDeviceLink.test.tsx`.
vi.mock('@/lib/components/posts/BrandedDeviceLink', async () => ({
  BrandedDeviceLink: (await import('./FitnessStatusDetail.mocks'))
    .MockBrandedDeviceLink
}))

const TWO_START = Date.parse('2026-05-27T18:00:00Z')

// A watch (primary) and a bike computer of one ride, plus the owner's view of
// both. `deviceGearName` is the editable name and wins over the recorded one.
const watch = (overrides: Partial<StatusFitnessFileItem> = {}) =>
  buildFitnessFile({
    id: 'fit-watch',
    fileName: 'watch.fit',
    deviceName: 'Forerunner 965',
    deviceManufacturer: 'garmin',
    totalDistanceMeters: 5000,
    totalDurationSeconds: 1800,
    ...overrides
  })

const headUnit = (overrides: Partial<StatusFitnessFileItem> = {}) =>
  buildFitnessFile({
    id: 'fit-edge',
    fileName: 'edge.fit',
    isPrimary: false,
    deviceName: 'Edge 840',
    deviceManufacturer: 'garmin',
    totalDistanceMeters: 5100,
    totalDurationSeconds: 1750,
    activityStartTime: TWO_START,
    ...overrides
  })

describe('FitnessStatusDetail recordings', () => {
  beforeEach(() => {
    resetFitnessStatusDetailMocks()
  })

  describe('picker rows', () => {
    it('names each recording by its device, falling back to the file name', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        watch({ deviceGearName: 'My watch' }),
        headUnit(),
        buildFitnessFile({
          id: 'fit-gpx',
          fileName: 'export.gpx',
          fileType: 'gpx',
          isPrimary: false,
          activityStartTime: TWO_START + 1000
        })
      ])
      renderDetail()

      // The gear row's name wins over the recorded device, on the trigger too.
      const menu = await openRecordingPicker('My watch')

      expect(getRecordingRow(menu, 'My watch')).toBeInTheDocument()
      expect(getRecordingRow(menu, 'Edge 840')).toBeInTheDocument()
      // A GPX export records no device at all.
      expect(getRecordingRow(menu, 'export.gpx')).toBeInTheDocument()
    })

    it('marks only the primary recording with a Primary pill', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([watch(), headUnit()])
      renderDetail()

      const menu = await openRecordingPicker('Forerunner 965')

      expect(within(menu).getAllByText('Primary')).toHaveLength(1)
      expect(
        within(getRecordingRow(menu, 'Forerunner 965')).getByText('Primary')
      ).toBeInTheDocument()
      expect(
        within(getRecordingRow(menu, 'Edge 840')).queryByText('Primary')
      ).not.toBeInTheDocument()
    })

    it('summarises each row as distance, elapsed time and file type, skipping what is missing', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        watch(),
        headUnit({
          totalDistanceMeters: null,
          totalDurationSeconds: null,
          fileType: 'tcx'
        })
      ])
      renderDetail()

      const menu = await openRecordingPicker('Forerunner 965')

      expect(
        within(getRecordingRow(menu, 'Forerunner 965')).getByText(
          '5.00 km · 30:00 · FIT'
        )
      ).toBeInTheDocument()
      // No distance and no time: only the type is left, with no stray dots.
      expect(
        within(getRecordingRow(menu, 'Edge 840')).getByText('TCX')
      ).toBeInTheDocument()
    })

    it('still offers the picker when no recording names a device', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ id: 'a', fileName: 'one.fit' }),
        buildFitnessFile({
          id: 'b',
          fileName: 'two.fit',
          isPrimary: false,
          activityStartTime: TWO_START
        })
      ])
      renderDetail()

      const menu = await openRecordingPicker('one.fit')

      expect(getRecordingRow(menu, 'two.fit')).toBeInTheDocument()
    })

    it('does not make a recording primary just by viewing it', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([watch(), headUnit()])
      renderDetail()

      await chooseRecording('Forerunner 965', 'Edge 840')

      expect(
        await screen.findByRole('button', { name: 'Edge 840' })
      ).toBeInTheDocument()
      expect(mockMakeFitnessFilePrimary).not.toHaveBeenCalled()
    })
  })

  describe('a single recording', () => {
    it('keeps the plain "Recorded with" line, with no picker', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([watch()])
      renderDetail()

      expect(await screen.findByText('Recorded with')).toBeInTheDocument()
      expect(
        await screen.findByTestId('branded-device-link')
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Forerunner 965/ })
      ).not.toBeInTheDocument()
    })
  })

  describe('download', () => {
    it('gives the owner an icon button beside the device line', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([watch()])
      renderDetail()

      const link = await screen.findByRole('link', {
        name: 'Download FIT file'
      })
      expect(link).toHaveAttribute('href', '/api/v1/fitness-files/fit-watch')
      expect(link).toHaveAttribute('title', 'Download FIT file')
    })

    it('downloads whichever recording is selected, named by its type', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        watch(),
        headUnit({ fileType: 'gpx' })
      ])
      renderDetail()

      expect(
        await screen.findByRole('link', { name: 'Download FIT file' })
      ).toHaveAttribute('href', '/api/v1/fitness-files/fit-watch')

      await chooseRecording('Forerunner 965', 'Edge 840')

      expect(
        await screen.findByRole('link', { name: 'Download GPX file' })
      ).toHaveAttribute('href', '/api/v1/fitness-files/fit-edge')
    })

    it('labels the download "Original file" when nothing names a device', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([buildFitnessFile()])
      renderDetail()

      const link = await screen.findByRole('link', {
        name: /download fit file/i
      })
      expect(link).toHaveTextContent('Original file')
      expect(screen.queryByText('Recorded with')).not.toBeInTheDocument()
    })

    it.each([
      { description: 'a signed-in viewer', currentActor: notMe },
      { description: 'a logged-out reader', currentActor: null }
    ])(
      'shows $description neither the download nor Make primary',
      async ({ currentActor }) => {
        mockGetFitnessFilesByStatus.mockResolvedValue([watch(), headUnit()])
        renderDetail({ currentActor })

        const menu = await openRecordingPicker('Forerunner 965')

        expect(getRecordingRow(menu, 'Edge 840')).toBeInTheDocument()
        expect(
          within(menu).queryByRole('menuitem', { name: /Make primary/ })
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('link', { name: /download/i })
        ).not.toBeInTheDocument()
      }
    )
  })

  describe('make primary', () => {
    it('offers it to the owner on every recording but the primary', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([watch(), headUnit()])
      renderDetail()

      const menu = await openRecordingPicker('Forerunner 965')

      expect(
        within(menu).getByRole('menuitem', { name: 'Make primary: Edge 840' })
      ).toBeInTheDocument()
      expect(
        within(menu).queryByRole('menuitem', {
          name: 'Make primary: Forerunner 965'
        })
      ).not.toBeInTheDocument()
    })

    it('promotes the recording, selects it and refreshes the page', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([watch(), headUnit()])
      mockMakeFitnessFilePrimary.mockResolvedValue(
        headUnit({ isPrimary: true, gearId: 'gear-1', gearName: 'Moots' })
      )
      renderDetail()

      const menu = await openRecordingPicker('Forerunner 965')
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: 'Make primary: Edge 840' })
      )

      await waitFor(() =>
        expect(mockMakeFitnessFilePrimary).toHaveBeenCalledWith('fit-edge')
      )
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Edge 840 is now the primary recording. The post and its map update shortly.'
      )
      expect(mockRefresh).toHaveBeenCalledTimes(1)
      // The page now shows the new primary (and the gear it inherited)...
      expect(
        await screen.findByRole('button', { name: 'Edge 840' })
      ).toBeInTheDocument()
      expect(
        await screen.findByRole('link', { name: /^Gear:/ })
      ).toHaveTextContent('Moots')
      // ...and the flags in the list moved with it.
      const reopened = await openRecordingPicker('Edge 840')
      expect(
        within(getRecordingRow(reopened, 'Edge 840')).getByText('Primary')
      ).toBeInTheDocument()
      expect(
        within(getRecordingRow(reopened, 'Forerunner 965')).queryByText(
          'Primary'
        )
      ).not.toBeInTheDocument()
      expect(
        within(reopened).getByRole('menuitem', {
          name: 'Make primary: Forerunner 965'
        })
      ).toBeInTheDocument()
    })

    it('shows it is in flight and disables the action until the request settles', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        watch(),
        headUnit(),
        headUnit({
          id: 'fit-third',
          fileName: 'third.fit',
          deviceName: 'Wahoo'
        })
      ])
      const request = createDeferred<StatusFitnessFileItem>()
      mockMakeFitnessFilePrimary.mockReturnValue(request.promise)
      renderDetail()

      const menu = await openRecordingPicker('Forerunner 965')
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: 'Make primary: Edge 840' })
      )

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Making this the primary recording'
      )
      const reopened = await openRecordingPicker('Forerunner 965')
      expect(
        within(reopened).getByRole('menuitem', {
          name: 'Make primary: Wahoo'
        })
      ).toHaveAttribute('aria-disabled', 'true')

      // An open menu hides the rest of the page from the accessibility tree.
      fireEvent.keyDown(reopened, { key: 'Escape' })
      await act(async () => {
        request.resolve(headUnit({ isPrimary: true }))
      })
      expect(await screen.findByRole('status')).toHaveTextContent(
        'is now the primary recording'
      )
    })

    it('says why, and keeps the old primary, when the request fails', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([watch(), headUnit()])
      mockMakeFitnessFilePrimary.mockRejectedValue(
        new Error('This recording could not be found.')
      )
      renderDetail()

      const menu = await openRecordingPicker('Forerunner 965')
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: 'Make primary: Edge 840' })
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This recording could not be found.'
      )
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(mockRefresh).not.toHaveBeenCalled()
      // Nothing moved: still on the old primary, which still carries the pill.
      const reopened = await openRecordingPicker('Forerunner 965')
      expect(
        within(getRecordingRow(reopened, 'Forerunner 965')).getByText('Primary')
      ).toBeInTheDocument()
    })

    it('clears a previous failure when the next attempt starts', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([watch(), headUnit()])
      mockMakeFitnessFilePrimary.mockRejectedValueOnce(new Error('Try later.'))
      mockMakeFitnessFilePrimary.mockResolvedValueOnce(
        headUnit({ isPrimary: true })
      )
      renderDetail()

      fireEvent.click(
        within(await openRecordingPicker('Forerunner 965')).getByRole(
          'menuitem',
          { name: 'Make primary: Edge 840' }
        )
      )
      expect(await screen.findByRole('alert')).toHaveTextContent('Try later.')

      fireEvent.click(
        within(await openRecordingPicker('Forerunner 965')).getByRole(
          'menuitem',
          { name: 'Make primary: Edge 840' }
        )
      )

      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      )
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Edge 840 is now the primary recording'
      )
    })
  })
})
