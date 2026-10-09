/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { GalleryAlbumPicker } from '@/app/(timeline)/gallery/albums/GalleryAlbumPicker'
import { getGalleryMedia, getGallerySubjects } from '@/lib/client'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'

vi.mock('@/lib/client', () => ({
  getGalleryMedia: vi.fn(),
  getGallerySubjects: vi.fn()
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>
}))

const media = vi.mocked(getGalleryMedia)
const subjects = vi.mocked(getGallerySubjects)

const place = (name: string) =>
  ({
    name,
    precision: 'exact',
    latitude: 1,
    longitude: 2,
    countryCode: 'GB'
  }) as GalleryItemEntity['place']

const named = (
  id: string,
  name: string,
  overrides: Partial<GalleryItemEntity> = {}
) =>
  buildGalleryItem(id, {
    attachment: { ...buildGalleryItem(id).attachment, name },
    ...overrides
  })

const Harness = ({
  capacity = 2000,
  existingIds,
  initialSelected = [],
  seedItems,
  onFirstItemChange
}: {
  capacity?: number
  existingIds?: string[]
  initialSelected?: string[]
  seedItems?: GalleryItemEntity[]
  onFirstItemChange?: (item: GalleryItemEntity | null) => void
}) => {
  const [selected, setSelected] = useState<string[]>(initialSelected)
  return (
    <>
      <GalleryAlbumPicker
        ownerId="owner"
        selected={selected}
        onChange={setSelected}
        onFirstItemChange={onFirstItemChange}
        capacity={capacity}
        existingIds={existingIds}
        seedItems={seedItems}
      />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  )
}

describe('GalleryAlbumPicker', () => {
  beforeEach(() => {
    media.mockReset()
    subjects.mockReset()
    subjects.mockResolvedValue({
      groups: [
        {
          category: 'bird',
          subjects: [{ key: 'sci:alcedo atthis', name: 'Common Kingfisher' }]
        }
      ],
      unidentifiedCount: 0,
      countryCount: null
    } as never)
  })

  it('ticks photos in the order picked and unticks them again', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextMaxId: null
    })
    render(<Harness />)

    const robin = await screen.findByRole('button', {
      name: 'Select Robin, photo 2'
    })
    fireEvent.click(robin)
    fireEvent.click(
      screen.getByRole('button', { name: 'Select Heron, photo 1' })
    )
    expect(screen.getByTestId('selected')).toHaveTextContent('2,1')
    expect(robin).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(robin)
    expect(screen.getByTestId('selected')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('')
  })

  it('stops at the capacity', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextMaxId: null
    })
    render(<Harness capacity={2} />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Select all shown' })
    )
    expect(screen.getByTestId('selected')).toHaveTextContent('1,2')
    expect(
      screen.getByRole('button', { name: 'Select Fox, photo 3' })
    ).toBeDisabled()
  })

  it('asks the server for a species and filters place and dates over what is loaded', async () => {
    media.mockResolvedValue({
      items: [
        named('1', 'Heron', {
          takenAt: '2026-05-02T10:00:00Z',
          place: place('Lee Valley')
        }),
        named('2', 'Robin', {
          takenAt: '2026-06-21T10:00:00Z',
          place: place('Hyde Park')
        })
      ],
      nextMaxId: null
    })
    render(<Harness />)
    await screen.findByRole('button', { name: 'Select Heron, photo 1' })

    fireEvent.change(screen.getByLabelText('Place'), {
      target: { value: 'Hyde Park' }
    })
    expect(
      screen.queryByRole('button', { name: /^Select Heron/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Select Robin, photo 1' })
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Taken from'), {
      target: { value: '2026-07-01' }
    })
    expect(
      screen.getByText('No photos match these filters.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(
      screen.getByRole('button', { name: 'Select Heron, photo 1' })
    ).toBeInTheDocument()

    fireEvent.change(await screen.findByLabelText('Species'), {
      target: { value: 'sci:alcedo atthis' }
    })
    await waitFor(() =>
      expect(media).toHaveBeenLastCalledWith(
        'owner',
        expect.objectContaining({ subject: 'sci:alcedo atthis' })
      )
    )
  })

  it('pages with Load more and keeps the picks', async () => {
    media
      .mockResolvedValueOnce({ items: [named('1', 'Heron')], nextMaxId: '1' })
      .mockResolvedValueOnce({ items: [named('0', 'Robin')], nextMaxId: null })
    render(<Harness />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Select Heron, photo 1' })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(
      await screen.findByRole('button', { name: 'Select Robin, photo 2' })
    ).toBeInTheDocument()
    expect(media).toHaveBeenLastCalledWith(
      'owner',
      expect.objectContaining({ maxId: '1' })
    )
    expect(screen.getByTestId('selected')).toHaveTextContent('1')
  })

  it('points an empty gallery to Recent', async () => {
    media.mockResolvedValue({ items: [], nextMaxId: null })
    render(<Harness />)
    expect(await screen.findByText('No photos to add yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Recent' })).toHaveAttribute(
      'href',
      '/gallery/recent'
    )
  })

  it('shows a load failure and retries', async () => {
    media
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [named('1', 'Heron')], nextMaxId: null })
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('button', { name: 'Select Heron, photo 1' })
    ).toBeInTheDocument()
  })

  it('names photos of one species apart', async () => {
    media.mockResolvedValue({
      items: ['1', '2', '3'].map((id) => named(id, 'Common kingfisher')),
      nextMaxId: null
    })
    render(<Harness />)

    await screen.findByRole('button', {
      name: 'Select Common kingfisher, photo 3'
    })
    const names = screen
      .getAllByRole('button', { name: /^Select / })
      .map((button) => button.getAttribute('aria-label'))
      .filter(Boolean)
    expect(names).toEqual([
      'Select Common kingfisher, photo 1',
      'Select Common kingfisher, photo 2',
      'Select Common kingfisher, photo 3'
    ])
  })

  it('shows photos already in the album as such and never picks them', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextMaxId: null
    })
    render(<Harness existingIds={['2']} />)

    const member = await screen.findByRole('button', {
      name: 'Robin, photo 2, already in the album'
    })
    expect(member).toBeDisabled()
    expect(member).toHaveTextContent('In album')
    expect(member).not.toHaveAttribute('aria-pressed')

    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('1,3')
  })

  it('does not submit the dialog form when Enter is pressed in a date field', async () => {
    media.mockResolvedValue({ items: [named('1', 'Heron')], nextMaxId: null })
    render(<Harness />)
    await screen.findByRole('button', { name: 'Select Heron, photo 1' })

    for (const label of ['Taken from', 'Taken to']) {
      // fireEvent returns false when the default action was prevented.
      expect(
        fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' })
      ).toBe(false)
    }
  })

  it('knows the cover of a preselected photo that is not in the loaded pages', async () => {
    media.mockResolvedValue({ items: [named('2', 'Robin')], nextMaxId: null })
    const onFirstItemChange = vi.fn()
    const seed = named('9', 'Heron')
    render(
      <Harness
        initialSelected={['9']}
        seedItems={[seed]}
        onFirstItemChange={onFirstItemChange}
      />
    )
    await screen.findByRole('button', { name: 'Select Robin, photo 1' })

    expect(onFirstItemChange).toHaveBeenLastCalledWith(seed)
  })

  it('has no cover for a preselected photo it was not told about', async () => {
    media.mockResolvedValue({ items: [named('2', 'Robin')], nextMaxId: null })
    const onFirstItemChange = vi.fn()
    render(
      <Harness initialSelected={['9']} onFirstItemChange={onFirstItemChange} />
    )
    await screen.findByRole('button', { name: 'Select Robin, photo 1' })

    expect(onFirstItemChange).toHaveBeenLastCalledWith(null)
  })
})
