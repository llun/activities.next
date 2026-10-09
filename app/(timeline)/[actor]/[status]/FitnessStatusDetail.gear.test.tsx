/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

import type { StatusFitnessFileItem } from '@/lib/client'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'
import { createDeferred } from '@/lib/testing/deferred'

import {
  buildFitnessFile,
  buildGear,
  chooseGear,
  expectGearLinkText,
  expectNoGearOnMetaLine,
  getGearItem,
  getGearLink,
  getGearMenu,
  mockGetFitnessFilesByStatus,
  mockGetFitnessGearList,
  mockUpdateFitnessFileGear,
  notMe,
  renderDetail,
  resetFitnessStatusDetailMocks
} from './FitnessStatusDetail.testUtils'

vi.mock('@/lib/client', () => ({
  getFitnessFilesByStatus: vi.fn(),
  getFitnessGearList: vi.fn(),
  getFitnessRouteData: vi.fn(),
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

describe('FitnessStatusDetail', () => {
  beforeEach(() => {
    resetFitnessStatusDetailMocks()
  })

  describe('gear', () => {
    it('offers the owner their active gear under "Change gear" in the post menu', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots', distanceMeters: 42_600 }),
        buildGear({ id: 'gear-other-bike', name: 'Winter bike' })
      ])

      renderDetail()

      const menu = await getGearMenu()
      expect(
        within(menu).getByRole('menuitem', { name: 'Change gear' })
      ).toBeInTheDocument()
      expect(
        within(menu).getByRole('menuitemradio', { name: 'No gear' })
      ).toBeInTheDocument()
      // The lifetime total rides along with the name, as the design shows it —
      // it is what tells two similar bikes apart at a glance.
      expect(
        within(menu).getByRole('menuitemradio', { name: /Moots/ })
      ).toHaveTextContent('Moots42.6 km')
      expect(
        within(menu).getByRole('menuitemradio', { name: /Winter bike/ })
      ).toBeInTheDocument()
      // Nothing is assigned, so the metadata line carries no gear at all — the
      // line is not a control any more, and "No gear" is only a submenu row.
      await expectNoGearOnMetaLine()
    })

    it('links the assigned gear to its gear page, with the lifetime total in the tooltip', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ gearId: 'gear-bike', gearName: 'Moots' })
      ])
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots', distanceMeters: 42_600 })
      ])

      renderDetail()

      const link = await getGearLink()
      expect(link).toHaveAttribute('href', '/fitness/gear/gear-bike')
      expect(link).toHaveTextContent('Moots')
      // The distance rides in the title rather than on the line, which is
      // already carrying the date and the visibility.
      await waitFor(() =>
        expect(screen.getByRole('link', { name: /^Gear:/ })).toHaveAttribute(
          'title',
          'Gear: Moots · 42.6 km'
        )
      )
    })

    it('names the gear without a distance before the shed has loaded', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ gearId: 'gear-bike', gearName: 'Moots' })
      ])
      // The list endpoint never answers, so the page only ever has the name the
      // status payload carried.
      mockGetFitnessGearList.mockImplementation(() => new Promise(() => {}))

      renderDetail()

      expect(await getGearLink()).toHaveAttribute('title', 'Gear: Moots')
    })

    it('narrows the options to the kind the activity implies', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots', kind: 'bike' }),
        buildGear({ id: 'gear-shoes', name: 'Nimbus 25', kind: 'shoes' }),
        buildGear({
          id: 'gear-retired',
          name: 'Sold bike',
          kind: 'bike',
          retiredAt: Date.parse('2026-02-01T00:00:00Z')
        })
      ])

      renderDetail()

      const menu = await getGearMenu()
      await waitFor(() =>
        expect(
          within(menu).getByRole('menuitemradio', { name: /Moots/ })
        ).toBeInTheDocument()
      )
      // A ride never offers shoes, and retired gear is out of the picker.
      expect(
        within(menu).queryByRole('menuitemradio', { name: /Nimbus 25/ })
      ).not.toBeInTheDocument()
      expect(
        within(menu).queryByRole('menuitemradio', { name: /Sold bike/ })
      ).not.toBeInTheDocument()
    })

    it.each([
      { description: 'a recognised activity type', activityType: 'ride' },
      // The leak this guards: an unrecognised type narrows to nothing and
      // offers every active gear, so the head unit that RECORDED the ride would
      // appear in the list of things it could have been done on.
      { description: 'an unrecognised activity type', activityType: 'kayaking' }
    ])(
      'never offers a recording device for $description',
      async ({ activityType }) => {
        mockGetFitnessFilesByStatus.mockResolvedValue([
          buildFitnessFile({ activityType })
        ])
        mockGetFitnessGearList.mockResolvedValue([
          buildGear({ id: 'gear-bike', name: 'Moots', kind: 'bike' }),
          buildGear({
            id: 'device-1',
            name: 'Garmin Edge 840',
            kind: 'device',
            deviceKey: 'name:garmin edge 840'
          } as Partial<GearEntity>)
        ])

        renderDetail()

        const menu = await getGearMenu()
        await waitFor(() =>
          expect(
            within(menu).getByRole('menuitemradio', { name: /Moots/ })
          ).toBeInTheDocument()
        )
        expect(
          within(menu).queryByRole('menuitemradio', { name: /Garmin Edge 840/ })
        ).not.toBeInTheDocument()
      }
    )

    it('hands the "Recorded with" line the device row and the owner flag', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({
          deviceName: 'Garmin Edge 840',
          deviceManufacturer: 'garmin',
          deviceGearId: 'device-1',
          deviceGearName: 'the Edge'
        })
      ])

      renderDetail()

      const link = await screen.findByTestId('branded-device-link')
      expect(link).toHaveAttribute('data-device-gear-id', 'device-1')
      expect(link).toHaveAttribute('data-device-gear-name', 'the Edge')
      expect(link).toHaveAttribute('data-is-owner', 'true')
    })

    it('renders the "Recorded with" line for a renamed device with no recorded brand', async () => {
      // The gear row's name overrides the recorded one, so the line's own gate
      // has to accept either — otherwise a renamed device vanishes.
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({
          deviceName: null,
          deviceManufacturer: null,
          deviceGearId: 'device-1',
          deviceGearName: 'My phone'
        })
      ])

      renderDetail()

      expect(await screen.findByText('Recorded with')).toBeInTheDocument()
      expect(await screen.findByTestId('branded-device-link')).toHaveAttribute(
        'data-device-gear-name',
        'My phone'
      )
    })

    it('shows no "Recorded with" line when nothing was recorded', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([buildFitnessFile()])

      renderDetail()

      await screen.findByText('Sunset loop')
      expect(screen.queryByText('Recorded with')).not.toBeInTheDocument()
    })

    it('keeps the assigned gear in the list even when the filter would drop it', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ gearId: 'gear-retired', gearName: 'Sold bike' })
      ])
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' }),
        buildGear({
          id: 'gear-retired',
          name: 'Sold bike',
          retiredAt: Date.parse('2026-02-01T00:00:00Z')
        })
      ])

      renderDetail()

      // A picker that cannot represent its own value renders the assignment as
      // something else, which reads as the gear having changed on its own.
      await expectGearLinkText('Sold bike')
      const menu = await getGearMenu()
      expect(
        within(menu).getByRole('menuitemradio', { name: /Sold bike/ })
      ).toBeInTheDocument()
    })

    it('shows a non-owner the gear name as plain text with no link', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ gearId: 'gear-bike', gearName: 'Moots' })
      ])

      renderDetail({ currentActor: notMe })

      // The icon carries it visually; the name is spelled out for a screen
      // reader and repeated in the title.
      expect(await screen.findByTitle('Gear: Moots')).toHaveTextContent(
        'Gear: Moots'
      )
      // `/fitness/gear/<id>` is owner-scoped, so a link offered here would only
      // ever 404 — the same constraint `BrandedDeviceLink` resolves the same
      // way on the line below.
      expect(
        screen.queryByRole('link', { name: /^Gear:/ })
      ).not.toBeInTheDocument()
      expect(mockGetFitnessGearList).not.toHaveBeenCalled()
    })

    it('offers a non-owner no way to change the gear', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ gearId: 'gear-bike', gearName: 'Moots' })
      ])

      renderDetail({ currentActor: notMe })

      await screen.findByTitle('Gear: Moots')
      expect(
        screen.queryByTestId('post-menu-submenu-change-gear')
      ).not.toBeInTheDocument()
    })

    it('shows a non-owner nothing when no gear is attributed', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([buildFitnessFile()])

      renderDetail({ currentActor: notMe })

      await waitFor(() =>
        expect(screen.getByText('ride.fit')).toBeInTheDocument()
      )
      expect(screen.queryByText(/^Gear/)).not.toBeInTheDocument()
    })

    it('updates the assignment optimistically and persists it', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])
      mockUpdateFitnessFileGear.mockResolvedValue({
        id: 'fit-1',
        gearId: 'gear-bike'
      })

      renderDetail()

      await chooseGear(/Moots/)

      await expectGearLinkText('Moots')
      expect(mockUpdateFitnessFileGear).toHaveBeenCalledWith(
        'fit-1',
        'gear-bike'
      )
    })

    it('reverts and reports an inline error when the update fails', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])
      mockUpdateFitnessFileGear.mockRejectedValue(
        new Error('Failed to update gear.')
      )

      renderDetail()

      await chooseGear(/Moots/)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to update gear.'
      )
      // The assignment goes back to what the server still holds, which for an
      // unassigned activity means no gear on the metadata line at all.
      await expectNoGearOnMetaLine()
    })

    it('reports the failure beside the gear it was for, not inside the menu', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ gearId: 'gear-bike', gearName: 'Moots' })
      ])
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' }),
        buildGear({ id: 'gear-other-bike', name: 'Winter bike' })
      ])
      mockUpdateFitnessFileGear.mockRejectedValue(new Error('Gear is retired.'))

      renderDetail()

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      await chooseGear(/Winter bike/)

      // The menu closes itself on select, so the error belongs on the metadata
      // line — beside the gear it failed to change — rather than in the menu it
      // was triggered from.
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Gear is retired.')
      expect(alert.id).toBe('activity-gear-error')
      expect(alert.previousElementSibling).toContainElement(
        screen.getByRole('link', { name: /^Gear:/ })
      )
      expect(screen.getByTestId('post-menu')).not.toContainElement(alert)
    })

    it('disables the whole submenu while the change is in flight', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])
      const deferred = createDeferred<{ id: string; gearId: string | null }>()
      mockUpdateFitnessFileGear.mockImplementation(() => deferred.promise)

      renderDetail()

      await chooseGear(/Moots/)

      // Two fast changes would otherwise race, and the loser's rollback would
      // restore an assignment the server has already replaced. The trigger is
      // disabled as well as the rows, so the submenu cannot even be opened
      // mid-write — a menu of choices none of which respond is worse than one
      // that will not open.
      const menu = await getGearMenu()
      await waitFor(() =>
        expect(
          within(menu).getByRole('menuitem', { name: 'Change gear' })
        ).toHaveAttribute('aria-disabled', 'true')
      )
      expect(getGearItem(menu, /Moots/)).toHaveAttribute(
        'aria-disabled',
        'true'
      )

      deferred.resolve({ id: 'fit-1', gearId: 'gear-bike' })
      await waitFor(() =>
        expect(
          within(menu).getByRole('menuitem', { name: 'Change gear' })
        ).toHaveAttribute('aria-disabled', 'false')
      )
    })

    it('ignores re-picking the gear that is already assigned', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ gearId: 'gear-bike', gearName: 'Moots' })
      ])
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])

      renderDetail()

      await expectGearLinkText('Moots')
      // Tapping the checked row to dismiss the menu is the natural gesture, and
      // a `<select>` never fired `onChange` for it. A write here would re-run
      // the service reminders and could surface an error for a change the owner
      // never made.
      await chooseGear(/Moots/)

      expect(mockUpdateFitnessFileGear).not.toHaveBeenCalled()
    })

    it('shows an owner with no gear at all nothing to pick', async () => {
      mockGetFitnessGearList.mockResolvedValue([])

      renderDetail()

      await waitFor(() =>
        expect(screen.getByText('ride.fit')).toBeInTheDocument()
      )
      // A submenu whose only entry is "No gear" is dead UI, so the whole item
      // is absent rather than empty — the same rule that keeps the metadata
      // line clear when nothing is attributed.
      expect(
        screen.queryByTestId('post-menu-submenu-change-gear')
      ).not.toBeInTheDocument()
      expect(screen.queryByText(/^Gear/)).not.toBeInTheDocument()
    })

    it('rolls back only this file, keeping a file list that landed mid-flight', async () => {
      // The status payload's single file is what renders first; the real list
      // arrives from `getFitnessFilesByStatus`, and here it lands while the
      // gear PATCH is still open.
      const fileList = createDeferred<StatusFitnessFileItem[]>()
      mockGetFitnessFilesByStatus.mockImplementation(() => fileList.promise)
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])
      let rejectUpdate: (error: Error) => void = () => {}
      mockUpdateFitnessFileGear.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectUpdate = reject
          })
      )

      renderDetail()

      await chooseGear(/Moots/)
      await expectGearLinkText('Moots')

      await act(async () => {
        fileList.resolve([
          buildFitnessFile(),
          buildFitnessFile({
            id: 'fit-2',
            fileName: 'second.fit',
            isPrimary: false,
            activityStartTime: Date.parse('2026-05-27T18:00:00Z')
          })
        ])
      })
      expect(await screen.findByLabelText('Activity file')).toBeInTheDocument()

      await act(async () => {
        rejectUpdate(new Error('Failed to update gear.'))
      })

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to update gear.'
      )
      // Only this file's assignment went back. Restoring the array captured
      // before the PATCH would have dropped the second file with it.
      await expectNoGearOnMetaLine()
      expect(screen.getByLabelText('Activity file')).toBeInTheDocument()
      expect(screen.getByText('file 1 of 2')).toBeInTheDocument()
    })

    it('keeps a failed change with its own file when the reader switches', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile(),
        buildFitnessFile({
          id: 'fit-2',
          fileName: 'second.fit',
          isPrimary: false,
          activityStartTime: Date.parse('2026-05-27T18:00:00Z')
        })
      ])
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])
      let rejectUpdate: (error: Error) => void = () => {}
      mockUpdateFitnessFileGear.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectUpdate = reject
          })
      )

      renderDetail()

      await chooseGear(/Moots/)
      // The file switcher stays enabled during the PATCH, so the reader can
      // move on before it fails. The error belongs to the file it happened to —
      // rendering it here would describe the wrong activity, and
      // `aria-describedby` would wire this file's picker to it.
      fireEvent.change(await screen.findByLabelText('Activity file'), {
        target: { value: 'fit-2' }
      })
      await act(async () => {
        rejectUpdate(new Error('Failed to update gear.'))
      })

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      // Switching back brings it with the file, because that is what happened.
      fireEvent.change(screen.getByLabelText('Activity file'), {
        target: { value: 'fit-1' }
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to update gear.'
      )
    })

    it('does not let a change to one file discard another file’s failure', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile(),
        buildFitnessFile({
          id: 'fit-2',
          fileName: 'second.fit',
          isPrimary: false,
          activityStartTime: Date.parse('2026-05-27T18:00:00Z')
        })
      ])
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])
      let rejectUpdate: (error: Error) => void = () => {}
      mockUpdateFitnessFileGear.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectUpdate = reject
          })
      )

      renderDetail()

      await chooseGear(/Moots/)
      fireEvent.change(await screen.findByLabelText('Activity file'), {
        target: { value: 'fit-2' }
      })
      await act(async () => {
        rejectUpdate(new Error('Failed to update gear.'))
      })

      // File 1's failure is hidden, not seen — so a successful change here must
      // not throw it away. Resetting the error unconditionally would leave file
      // 1 rolled back to its old gear with nothing anywhere saying why.
      mockUpdateFitnessFileGear.mockResolvedValue({
        id: 'fit-2',
        gearId: 'gear-bike'
      })
      await chooseGear(/Moots/)
      await waitFor(() =>
        expect(mockUpdateFitnessFileGear).toHaveBeenCalledWith(
          'fit-2',
          'gear-bike'
        )
      )

      fireEvent.change(screen.getByLabelText('Activity file'), {
        target: { value: 'fit-1' }
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to update gear.'
      )
    })

    it('keeps both files’ failures when each change fails in turn', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile(),
        buildFitnessFile({
          id: 'fit-2',
          fileName: 'second.fit',
          isPrimary: false,
          activityStartTime: Date.parse('2026-05-27T18:00:00Z')
        })
      ])
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])
      let rejectUpdate: (error: Error) => void = () => {}
      mockUpdateFitnessFileGear.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectUpdate = reject
          })
      )

      renderDetail()

      await chooseGear(/Moots/)
      fireEvent.change(await screen.findByLabelText('Activity file'), {
        target: { value: 'fit-2' }
      })
      await act(async () => {
        rejectUpdate(new Error('Failed to update gear.'))
      })

      // A second failure must not evict the first: one error slot for the whole
      // component would drop file 1's — which nobody had seen, because it was
      // hidden while the reader was here.
      await chooseGear(/Moots/)
      await act(async () => {
        rejectUpdate(new Error('Gear is retired.'))
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Gear is retired.'
      )

      fireEvent.change(screen.getByLabelText('Activity file'), {
        target: { value: 'fit-1' }
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to update gear.'
      )
    })

    it('sends null when the owner clears the assignment', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ gearId: 'gear-bike', gearName: 'Moots' })
      ])
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])
      mockUpdateFitnessFileGear.mockResolvedValue({
        id: 'fit-1',
        gearId: null
      })

      renderDetail()

      await expectGearLinkText('Moots')

      await chooseGear('No gear')

      await waitFor(() =>
        expect(mockUpdateFitnessFileGear).toHaveBeenCalledWith('fit-1', null)
      )
      // Cleared, so the metadata line drops the gear entirely rather than
      // reading "No gear" — that phrase only exists as the submenu's own row.
      await expectNoGearOnMetaLine()
    })

    it('marks the assigned gear as the checked row', async () => {
      mockGetFitnessFilesByStatus.mockResolvedValue([
        buildFitnessFile({ gearId: 'gear-bike', gearName: 'Moots' })
      ])
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' }),
        buildGear({ id: 'gear-other-bike', name: 'Winter bike' })
      ])

      renderDetail()

      const menu = await getGearMenu()
      await waitFor(() =>
        expect(getGearItem(menu, /Moots/)).toHaveAttribute(
          'aria-checked',
          'true'
        )
      )
      expect(getGearItem(menu, /Winter bike/)).toHaveAttribute(
        'aria-checked',
        'false'
      )
      expect(getGearItem(menu, 'No gear')).toHaveAttribute(
        'aria-checked',
        'false'
      )
    })

    it('checks "No gear" when nothing is assigned', async () => {
      mockGetFitnessGearList.mockResolvedValue([
        buildGear({ id: 'gear-bike', name: 'Moots' })
      ])

      renderDetail()

      const menu = await getGearMenu()
      expect(getGearItem(menu, 'No gear')).toHaveAttribute(
        'aria-checked',
        'true'
      )
    })
  })
})
