/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createGalleryGear, updateGalleryGear } from '@/lib/client'
import type { GalleryGearEntity } from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'

import { GalleryGearFormDialog } from './GalleryGearFormDialog'

vi.mock('@/lib/client', () => ({
  createGalleryGear: vi.fn(),
  updateGalleryGear: vi.fn()
}))

const mockCreate = vi.mocked(createGalleryGear)
const mockUpdate = vi.mocked(updateGalleryGear)

const gear: GalleryGearEntity = {
  id: 'g1',
  kind: 'camera',
  name: 'Sony α1',
  brand: 'Sony',
  model: 'ILCE-1',
  productUrl: 'https://sony.com/a1',
  retiredAt: null,
  createdAt: 1
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('GalleryGearFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a gear of the section’s kind', async () => {
    mockCreate.mockResolvedValue({ ...gear, id: 'new' })
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <GalleryGearFormDialog
        open
        kind="lens"
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />
    )

    expect(screen.getByRole('dialog', { name: 'Add a lens' })).toBeVisible()
    type('Name', '  FE 600mm  ')
    type('Brand', 'Sony')
    type('Product page', 'https://sony.com/600')
    fireEvent.click(screen.getByRole('button', { name: 'Save lens' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(mockCreate).toHaveBeenCalledWith({
      kind: 'lens',
      name: 'FE 600mm',
      brand: 'Sony',
      model: null,
      productUrl: 'https://sony.com/600'
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('falls back to brand and model when the name is empty', async () => {
    mockCreate.mockResolvedValue(gear)
    render(
      <GalleryGearFormDialog
        open
        kind="camera"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    type('Brand', 'Canon')
    type('Model', 'R5')
    fireEvent.click(screen.getByRole('button', { name: 'Save camera' }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Canon R5' })
      )
    )
  })

  it('asks for a name when there is nothing to derive one from', () => {
    render(
      <GalleryGearFormDialog
        open
        kind="camera"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save camera' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Give the camera a name.'
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('edits an existing gear, sending blanks as clears', async () => {
    mockUpdate.mockResolvedValue(gear)
    const onSaved = vi.fn()
    render(
      <GalleryGearFormDialog
        open
        kind="camera"
        gear={gear}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />
    )

    expect(screen.getByRole('dialog', { name: 'Edit camera' })).toBeVisible()
    expect(screen.getByLabelText('Name')).toHaveValue('Sony α1')
    expect(screen.getByLabelText('Model')).toHaveValue('ILCE-1')
    type('Product page', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(mockUpdate).toHaveBeenCalledWith('g1', {
      name: 'Sony α1',
      brand: 'Sony',
      model: 'ILCE-1',
      productUrl: null
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('shows the API error and stays open, then disables fields while saving', async () => {
    const deferred = createDeferred<GalleryGearEntity>()
    mockUpdate.mockReturnValueOnce(deferred.promise)
    const onOpenChange = vi.fn()
    render(
      <GalleryGearFormDialog
        open
        kind="camera"
        gear={gear}
        onOpenChange={onOpenChange}
        onSaved={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByLabelText('Name')).toBeDisabled()

    deferred.reject(new Error('Unprocessable entity'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unprocessable entity'
    )
    expect(screen.getByLabelText('Name')).toBeEnabled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
