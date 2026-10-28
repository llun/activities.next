/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { ArchiveExportSection } from '@/app/(timeline)/account/import-export/ArchiveExportSection'
import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'
import { withTimeZone } from '@/lib/testing/withTimeZone'

const mocks = vi.hoisted(() => ({
  listArchives: vi.fn(),
  requestArchive: vi.fn(),
  listDrafts: vi.fn()
}))

vi.mock('@/lib/client/accountArchives', () => ({
  listAccountArchives: mocks.listArchives,
  requestAccountArchive: mocks.requestArchive
}))

vi.mock('@/lib/client/drafts/draftsDb', () => ({
  listDrafts: mocks.listDrafts
}))

vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ state: 'online' })
}))

class TestResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

const readyArchive = {
  id: 'archive-ready',
  status: 'ready',
  stripExactLocations: false,
  includesDrafts: false,
  bytes: 1024 ** 2,
  createdAt: '2026-10-28T09:00:00.000Z',
  readyAt: '2026-10-28T10:00:00.000Z',
  expiresAt: '2026-11-04T10:00:00.000Z',
  error: null,
  downloadUrl: '/api/v1/account/archives/archive-ready/download'
}

describe('ArchiveExportSection dates', () => {
  beforeEach(() => {
    mocks.listArchives.mockReset().mockResolvedValue([])
    mocks.requestArchive.mockReset()
    mocks.listDrafts.mockReset().mockResolvedValue([])
  })

  it('renders archive times in UTC on the server and locally after hydration', async () => {
    await withTimeZone('America/New_York', async () => {
      const { serverHtml, container, onRecoverableError, unmount } =
        await hydrateServerHtml(
          <ArchiveExportSection
            actorId="actor-1"
            currentTime={Date.parse('2026-10-28T12:00:00.000Z')}
            initialArchives={[readyArchive] as never}
            exportAvailable
          />
        )

      try {
        // The server cannot know the viewer's zone, so it says UTC.
        expect(serverHtml).toContain('made 28 Oct 2026, 09:00')
        expect(onRecoverableError).not.toHaveBeenCalled()
        // New York is four hours behind UTC in October.
        expect(container).toHaveTextContent('made 28 Oct 2026, 05:00')
      } finally {
        unmount()
      }
    })
  })
})
