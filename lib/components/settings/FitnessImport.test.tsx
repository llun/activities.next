/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stageShareFiles } from '@/lib/client/share-target/shareTargetDb'

import { FitnessImport } from './FitnessImport'

vi.mock('@/lib/client', () => ({
  startFitnessImport: vi.fn(),
  getFitnessImportBatch: vi.fn(),
  retryFitnessImportBatch: vi.fn()
}))

const file = (name: string, type: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type })

describe('FitnessImport share intake', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    window.history.replaceState(null, '', '/fitness/files')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('preselects the shared workouts and strips the parameter', async () => {
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
    expect(window.location.search).toBe('')
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

  it('does nothing without a share parameter', async () => {
    render(<FitnessImport />)

    expect(screen.getByText('No files chosen')).toBeInTheDocument()
    expect(
      screen.queryByText("Photos weren't imported")
    ).not.toBeInTheDocument()
  })
})
