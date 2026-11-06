/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startFitnessImport } from '@/lib/client'
import {
  markSharePurgePending,
  readSharePurgePending
} from '@/lib/client/share-target/pendingSharePurge'
import {
  peekStagedShare,
  stageShareFiles
} from '@/lib/client/share-target/shareTargetDb'

import { FitnessImport } from './FitnessImport'

vi.mock('@/lib/client', () => ({
  startFitnessImport: vi.fn(),
  getFitnessImportBatch: vi.fn(),
  retryFitnessImportBatch: vi.fn()
}))

// A 4-byte limit, so an "oversize" workout needs no 50 MiB fixture.
vi.mock('@/lib/services/fitness-files/constants', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/services/fitness-files/constants')
  >()),
  DEFAULT_FITNESS_MAX_FILE_SIZE: 4
}))

const file = (name: string, type: string, bytes = [1, 2, 3]) =>
  new File([new Uint8Array(bytes)], name, { type })

describe('FitnessImport share intake', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.mocked(startFitnessImport).mockReset()
    localStorage.clear()
    window.history.replaceState(null, '', '/fitness/files')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // Any site can submit a share: the preselected workouts upload only when
  // the reader presses Import, and the share is kept until then.
  it('preselects the shared workouts and uploads nothing before Import', async () => {
    vi.mocked(startFitnessImport).mockResolvedValue({ batchId: 'b1' } as never)
    const id = await stageShareFiles([
      file('run.fit', 'application/vnd.ant.fit'),
      file('ride.gpx', 'application/gpx+xml')
    ])
    window.history.replaceState(null, '', `/fitness/files?share=${id}`)

    render(<FitnessImport />)

    await waitFor(() =>
      expect(screen.getByText('2 files chosen')).toBeInTheDocument()
    )
    expect(screen.getByText('run.fit')).toBeInTheDocument()
    expect(screen.getByText('ride.gpx')).toBeInTheDocument()
    expect(startFitnessImport).not.toHaveBeenCalled()
    expect(window.location.search).toBe(`?share=${id}`)
    expect(await peekStagedShare(id!)).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Import 2' }))

    await waitFor(() => expect(startFitnessImport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(await peekStagedShare(id!)).toBeNull()
  })

  it('skips oversize workouts and files without a fitness extension', async () => {
    const id = await stageShareFiles([
      file('run.fit', 'application/vnd.ant.fit'),
      file('huge.gpx', 'application/gpx+xml', [1, 2, 3, 4, 5]),
      file('notes.xml', 'text/xml')
    ])
    window.history.replaceState(null, '', `/fitness/files?share=${id}`)

    render(<FitnessImport />)

    await waitFor(() =>
      expect(
        screen.getByText('Some shared files were skipped')
      ).toBeInTheDocument()
    )
    expect(screen.getByText(/1 workout is over the/)).toBeInTheDocument()
    expect(
      screen.getByText(/1 file is not a .fit, .gpx or .tcx file/)
    ).toBeInTheDocument()
    expect(screen.getByText('run.fit')).toBeInTheDocument()
    expect(screen.queryByText('huge.gpx')).not.toBeInTheDocument()
    expect(screen.queryByText('notes.xml')).not.toBeInTheDocument()
  })

  it('notes the photos a batch share could not import', async () => {
    const id = await stageShareFiles([
      file('run.fit', 'application/vnd.ant.fit'),
      file('ride.gpx', 'application/gpx+xml'),
      file('photo.jpg', 'image/jpeg')
    ])
    window.history.replaceState(null, '', `/fitness/files?share=${id}`)

    render(<FitnessImport />)

    await waitFor(() =>
      expect(screen.getByText("Photos weren't imported")).toBeInTheDocument()
    )
    expect(screen.getByText(/1 shared photo was left out/)).toBeInTheDocument()
    expect(screen.getByText('2 files chosen')).toBeInTheDocument()
  })

  // 21 workouts: the worker staged 20 and counted one in `skipped`.
  it('names the files the worker could not stage', async () => {
    const id = await stageShareFiles(
      [
        file('run.fit', 'application/vnd.ant.fit'),
        file('ride.gpx', 'application/gpx+xml')
      ],
      { skipped: 1 }
    )
    window.history.replaceState(null, '', `/fitness/files?share=${id}`)

    render(<FitnessImport />)

    expect(
      await screen.findByText(
        /1 file was past the share limit of 20 files and 250 MB/
      )
    ).toBeInTheDocument()
    expect(screen.getByText('2 files chosen')).toBeInTheDocument()
  })

  it("preselects nothing from a failed sign-out's shares", async () => {
    const id = await stageShareFiles([
      file('run.fit', 'application/vnd.ant.fit'),
      file('ride.gpx', 'application/gpx+xml')
    ])
    await markSharePurgePending(Date.now())
    window.history.replaceState(null, '', `/fitness/files?share=${id}`)

    render(<FitnessImport />)

    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.getByText('No files chosen')).toBeInTheDocument()
    expect(await peekStagedShare(id!)).toBeNull()
    expect(await readSharePurgePending()).toBeNull()
  })

  it('does nothing without a share parameter', async () => {
    render(<FitnessImport />)

    expect(screen.getByText('No files chosen')).toBeInTheDocument()
    expect(
      screen.queryByText("Photos weren't imported")
    ).not.toBeInTheDocument()
  })
})
