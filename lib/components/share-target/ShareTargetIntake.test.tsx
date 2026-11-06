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

import {
  peekStagedShare,
  stageShareFiles
} from '@/lib/client/share-target/shareTargetDb'

import { ShareTargetIntake } from './ShareTargetIntake'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() })
}))

const file = (name: string, type: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type })

const stage = async () => {
  const id = await stageShareFiles([
    file('summit.jpg', 'image/jpeg'),
    file('ride.fit', '')
  ])
  window.history.replaceState(null, '', `/app?share=${id}`)
  return id!
}

describe('ShareTargetIntake', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/app')
  })

  // A share can come from any site (an auto-submitted form): its files reach
  // the composer, and so upload, only after the reader presses Add to post.
  it('lists the shared files and hands nothing to the composer until Add to post', async () => {
    const onSeed = vi.fn()
    const id = await stage()

    render(<ShareTargetIntake isMediaUploadEnabled onSeed={onSeed} />)

    expect(
      await screen.findByText('1 photo and 1 workout were shared')
    ).toBeInTheDocument()
    expect(screen.getByText('summit.jpg')).toBeInTheDocument()
    expect(screen.getByText('ride.fit')).toBeInTheDocument()
    // Still staged and unused after the intake has settled.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await peekStagedShare(id)).not.toBeNull()
    expect(onSeed).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add to post' }))

    await waitFor(() => expect(onSeed).toHaveBeenCalledTimes(1))
    const [seed] = onSeed.mock.calls[0]
    expect(seed.media.map((f: File) => f.name)).toEqual(['summit.jpg'])
    expect(seed.fitnessFile.name).toBe('ride.fit')
    expect(await peekStagedShare(id)).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Add to post' })
    ).not.toBeInTheDocument()
  })

  it('discards a share without handing it to the composer', async () => {
    const onSeed = vi.fn()
    const id = await stage()

    render(<ShareTargetIntake isMediaUploadEnabled onSeed={onSeed} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Discard' })
      ).not.toBeInTheDocument()
    )
    expect(onSeed).not.toHaveBeenCalled()
    expect(await peekStagedShare(id)).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('skips shared media, with a notice, when media uploads are off', async () => {
    await stage()

    render(<ShareTargetIntake isMediaUploadEnabled={false} onSeed={vi.fn()} />)

    expect(await screen.findByText('1 workout was shared')).toBeInTheDocument()
    expect(
      screen.getByText(/because this server takes no media uploads/)
    ).toBeInTheDocument()
    expect(screen.queryByText('summit.jpg')).not.toBeInTheDocument()
  })
})
