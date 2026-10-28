/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { serializeAccountImport } from '@/lib/services/accountImport/serialize'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'

const getAccountArchivesForAccount = vi.fn()
const getLatestRequestedAccountArchive = vi.fn()
const listAccountImports = vi.fn()
const countAccountImportItemsByOutcome = vi.fn()

const mockDatabase = {
  getAccountArchivesForAccount,
  getLatestRequestedAccountArchive,
  listAccountImports,
  countAccountImportItemsByOutcome
}

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } })
}))

const ACTOR = {
  id: 'https://llun.test/users/may',
  username: 'may',
  domain: 'llun.test',
  account: { id: 'acct-1' }
}

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/lib/services/accountArchive/objectStore', () => ({
  getArchiveObjectStore: vi.fn(() => null)
}))

vi.mock('@/lib/services/accountArchive/expiry', () => ({
  expireArchiveIfDue: vi.fn(async (_database, archive) => archive)
}))

vi.mock('@/lib/services/accountArchive/reaper', () => ({
  reapStuckAccountArchive: vi.fn(async (_database, archive) => archive)
}))

vi.mock('@/lib/services/accountArchive/serialize', () => ({
  toArchiveResponse: vi.fn((archive) => archive)
}))

vi.mock('@/lib/services/accountImport/serialize', () => ({
  serializeAccountImport: vi.fn(
    (accountImport: Record<string, unknown>, report?: unknown) => ({
      ...accountImport,
      report
    })
  )
}))

vi.mock('@/lib/config/accountImport', () => ({
  getAccountImportConfig: vi.fn(() => ({ maxFileSize: 1024 * 1024 }))
}))

const importSectionProps = vi.fn()

vi.mock('./ImportSection', () => ({
  ImportSection: (props: Record<string, unknown>) => {
    importSectionProps(props)
    return <div data-testid="import-section" />
  }
}))

vi.mock('./ArchiveExportSection', () => ({
  ArchiveExportSection: () => <div data-testid="archive-export" />
}))

vi.mock('./CsvDownloadsSection', () => ({
  CsvDownloadsSection: () => <div data-testid="csv-downloads" />
}))

const runningImport = {
  id: 'import-running',
  accountId: 'acct-1',
  status: 'running',
  kind: 'activities.next',
  phase: 'statuses',
  progress: {},
  createdAt: '2026-10-28T09:00:00.000Z',
  startedAt: '2026-10-28T09:00:10.000Z',
  finishedAt: null,
  lastErrorCode: null
}

const doneImport = {
  id: 'import-done',
  accountId: 'acct-1',
  status: 'done',
  kind: 'activities.next',
  phase: null,
  progress: {},
  createdAt: '2026-10-28T10:00:00.000Z',
  startedAt: '2026-10-28T10:00:10.000Z',
  finishedAt: '2026-10-28T10:05:00.000Z',
  lastErrorCode: null
}

const cancelledNotStartedImport = {
  id: 'import-cancelled-not-started',
  accountId: 'acct-1',
  status: 'cancelled',
  kind: null,
  phase: null,
  progress: {},
  createdAt: '2026-10-28T11:00:00.000Z',
  startedAt: null,
  finishedAt: '2026-10-28T11:00:30.000Z',
  lastErrorCode: null
}

const report = {
  done: { status: 6 },
  skipped: {},
  failed: {}
}

describe('/account/import-export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActorFromSession).mockResolvedValue(ACTOR as never)
    getAccountArchivesForAccount.mockResolvedValue([])
    getLatestRequestedAccountArchive.mockResolvedValue(null)
    listAccountImports.mockResolvedValue([])
    countAccountImportItemsByOutcome.mockResolvedValue(report)
  })

  it('renders the page with its three sections', async () => {
    render(await Page())

    expect(screen.getByTestId('archive-export')).toBeInTheDocument()
    expect(screen.getByTestId('csv-downloads')).toBeInTheDocument()
    expect(screen.getByTestId('import-section')).toBeInTheDocument()
  })

  it('prefers the active import over a newer terminal one', async () => {
    listAccountImports.mockResolvedValue([doneImport, runningImport])

    render(await Page())

    expect(serializeAccountImport).toHaveBeenCalledWith(
      runningImport,
      undefined
    )
    expect(importSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({
        initialImport: expect.objectContaining({ id: 'import-running' })
      })
    )
  })

  it('attaches a report only to a terminal import', async () => {
    listAccountImports.mockResolvedValue([runningImport])
    render(await Page())
    expect(countAccountImportItemsByOutcome).not.toHaveBeenCalled()
    expect(serializeAccountImport).toHaveBeenCalledWith(
      runningImport,
      undefined
    )
    expect(importSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({
        initialImport: expect.objectContaining({ report: undefined })
      })
    )

    vi.clearAllMocks()
    listAccountImports.mockResolvedValue([doneImport])
    render(await Page())
    expect(countAccountImportItemsByOutcome).toHaveBeenCalledWith({
      importId: 'import-done'
    })
    expect(serializeAccountImport).toHaveBeenCalledWith(doneImport, report)
    expect(importSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({
        initialImport: expect.objectContaining({ report })
      })
    )
  })

  it('skips a cancelled import that never started for an older finished one', async () => {
    // What a Discard, a failed upload or a refused start leaves behind: the
    // newest row, cancelled before it ever ran.
    listAccountImports.mockResolvedValue([
      cancelledNotStartedImport,
      doneImport
    ])

    render(await Page())

    expect(serializeAccountImport).toHaveBeenCalledWith(doneImport, report)
    expect(importSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({
        initialImport: expect.objectContaining({ id: 'import-done' })
      })
    )
  })

  it('passes no import when the only row was cancelled before it started', async () => {
    listAccountImports.mockResolvedValue([cancelledNotStartedImport])

    render(await Page())

    expect(serializeAccountImport).not.toHaveBeenCalled()
    expect(importSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialImport: null })
    )
  })

  it('filters the imports by account', async () => {
    listAccountImports.mockResolvedValue([
      { ...runningImport, accountId: 'acct-2' },
      doneImport
    ])

    render(await Page())

    expect(serializeAccountImport).toHaveBeenCalledWith(doneImport, report)
    expect(importSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({
        initialImport: expect.objectContaining({ id: 'import-done' })
      })
    )
  })

  it("seeds the import section's moved state from the actor", async () => {
    render(await Page())
    expect(importSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialMoved: false })
    )

    vi.clearAllMocks()
    vi.mocked(getActorFromSession).mockResolvedValue({
      ...ACTOR,
      movedTo: 'https://llun.test/users/may2'
    } as never)
    render(await Page())
    expect(importSectionProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialMoved: true })
    )
  })
})
