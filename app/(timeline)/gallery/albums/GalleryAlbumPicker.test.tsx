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

const Harness = ({ capacity = 2000 }: { capacity?: number }) => {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <>
      <GalleryAlbumPicker
        ownerId="owner"
        selected={selected}
        onChange={setSelected}
        capacity={capacity}
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

    const robin = await screen.findByRole('button', { name: 'Select Robin' })
    fireEvent.click(robin)
    fireEvent.click(screen.getByRole('button', { name: 'Select Heron' }))
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
    expect(screen.getByRole('button', { name: 'Select Fox' })).toBeDisabled()
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
    await screen.findByRole('button', { name: 'Select Heron' })

    fireEvent.change(screen.getByLabelText('Place'), {
      target: { value: 'Hyde Park' }
    })
    expect(
      screen.queryByRole('button', { name: 'Select Heron' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Select Robin' })
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Taken from'), {
      target: { value: '2026-07-01' }
    })
    expect(
      screen.getByText('No photos match these filters.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(
      screen.getByRole('button', { name: 'Select Heron' })
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

    fireEvent.click(await screen.findByRole('button', { name: 'Select Heron' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(
      await screen.findByRole('button', { name: 'Select Robin' })
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
      await screen.findByRole('button', { name: 'Select Heron' })
    ).toBeInTheDocument()
  })
})
