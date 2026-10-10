/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { deleteUnpostedMedia } from '@/lib/client'

import { ConfirmDeleteMediaDialog } from './ConfirmDeleteMediaDialog'

vi.mock('@/lib/client', () => ({ deleteUnpostedMedia: vi.fn() }))

const deleteMock = vi.mocked(deleteUnpostedMedia)

describe('ConfirmDeleteMediaDialog', () => {
  beforeEach(() => {
    deleteMock.mockReset()
  })

  const renderDialog = (mediaIds = ['1', '2', '3']) => {
    const handlers = {
      onCancel: vi.fn(),
      onDeleted: vi.fn(),
      onPartlyDeleted: vi.fn()
    }
    render(<ConfirmDeleteMediaDialog mediaIds={mediaIds} {...handlers} />)
    return handlers
  }

  it('asks with the count and says it cannot be undone, deleting nothing yet', () => {
    renderDialog()

    expect(
      screen.getByRole('dialog', { name: 'Delete 3 photos?' })
    ).toHaveTextContent('This can’t be undone.')
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('uses the singular for one photo', () => {
    renderDialog(['1'])
    expect(
      screen.getByRole('dialog', { name: 'Delete 1 photo?' })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete 1 photo' })).toBeVisible()
  })

  it('deletes each photo, then reports them', async () => {
    deleteMock.mockResolvedValue(undefined)
    const { onDeleted, onCancel } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 photos' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(['1', '2', '3']))
    expect(deleteMock.mock.calls.map((call) => call[0])).toEqual([
      '1',
      '2',
      '3'
    ])
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels without deleting', () => {
    const { onCancel } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('stays open with the reason when a delete fails, and says how many went', async () => {
    deleteMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('This photo is in a post'))
      .mockResolvedValueOnce(undefined)
    const { onDeleted, onPartlyDeleted } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 photos' }))

    expect(
      await screen.findByText('Deleted 2 of 3. This photo is in a post')
    ).toBeVisible()
    expect(onPartlyDeleted).toHaveBeenCalledWith(['1', '3'])
    expect(onDeleted).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Delete 3 photos' })
    ).toBeEnabled()
  })

  it('shows just the reason when nothing was deleted', async () => {
    deleteMock.mockRejectedValue(new Error('Server said no'))
    const { onPartlyDeleted } = renderDialog(['1'])

    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 photo' }))

    expect(await screen.findByText('Server said no')).toBeVisible()
    expect(onPartlyDeleted).not.toHaveBeenCalled()
  })
})
