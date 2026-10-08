/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { getGalleryGearsWithUsage } from '@/lib/client'
import type { GalleryGearWithUsageEntity } from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'

import { GalleryGearListView } from './GalleryGearListView'

vi.mock('@/lib/client', () => ({
  createGalleryGear: vi.fn(),
  getGalleryGearsWithUsage: vi.fn(),
  updateGalleryGear: vi.fn()
}))

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush })
}))

const mockGetGears = vi.mocked(getGalleryGearsWithUsage)

const createGear = (
  overrides: Partial<GalleryGearWithUsageEntity> = {}
): GalleryGearWithUsageEntity => ({
  id: 'cam-1',
  kind: 'camera',
  name: 'Sony α1',
  brand: 'Sony',
  model: 'ILCE-1',
  productUrl: 'https://www.sony.com/alpha',
  retiredAt: null,
  createdAt: Date.UTC(2024, 2, 12),
  photoCount: 812,
  videoCount: 34,
  countryCount: 5,
  firstUsedAt: Date.UTC(2024, 2, 14),
  lastUsedAt: Date.UTC(2026, 9, 7),
  ...overrides
})

const retiredCamera = createGear({
  id: 'cam-2',
  name: 'Sony α7 IV',
  model: 'ILCE-7M4',
  productUrl: null,
  retiredAt: Date.UTC(2024, 1, 20),
  photoCount: 188,
  firstUsedAt: Date.UTC(2022, 2, 3)
})

const lens = createGear({
  id: 'lens-1',
  kind: 'lens',
  name: 'FE 600mm F4 GM',
  model: 'SEL600F40GM',
  photoCount: 402,
  firstUsedAt: Date.UTC(2024, 3, 2)
})

const getSection = async (title: string) => {
  const heading = await screen.findByRole('heading', { name: title })
  const section = heading.closest('section')
  if (!section) throw new Error(`No section found for ${title}`)
  return within(section as HTMLElement)
}

describe('GalleryGearListView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGears.mockResolvedValue([])
  })

  it('shows a loading status, then the Cameras and Lenses sections', async () => {
    const deferred = createDeferred<GalleryGearWithUsageEntity[]>()
    mockGetGears.mockReturnValueOnce(deferred.promise)
    render(<GalleryGearListView />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading gear')

    deferred.resolve([createGear(), lens])

    expect(
      await screen.findByRole('heading', { name: 'Cameras' })
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Lenses' })).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('draws each row as name, brand and model, product host, used and photos', async () => {
    mockGetGears.mockResolvedValue([createGear(), lens])
    render(<GalleryGearListView />)

    const cameras = await getSection('Cameras')
    expect(cameras.getByText('1 active')).toBeVisible()
    expect(
      cameras.getAllByRole('columnheader').map((cell) => cell.textContent)
    ).toEqual(['Camera', 'Product page', 'Used', 'Photos', 'Actions'])
    const row = cameras.getByRole('link', { name: 'Sony α1' }).closest('tr')!
    expect(within(row).getByText('Sony · ILCE-1')).toBeVisible()
    expect(
      within(row).getByRole('link', { name: 'Product page: sony.com' })
    ).toHaveAttribute('href', 'https://www.sony.com/alpha')
    expect(within(row).getByText('Mar 2024 to now')).toBeVisible()
    expect(within(row).getByText('812')).toBeVisible()
    expect(
      within(row).getByRole('button', { name: 'Edit Sony α1' })
    ).toBeVisible()

    const lenses = await getSection('Lenses')
    expect(lenses.getByText('Apr 2024 to now')).toBeVisible()
    expect(lenses.getByText('402')).toBeVisible()
  })

  it('keeps retired gear behind a Show/Hide toggle', async () => {
    mockGetGears.mockResolvedValue([createGear(), retiredCamera])
    render(<GalleryGearListView />)

    const cameras = await getSection('Cameras')
    expect(cameras.getByText('1 active')).toBeVisible()
    expect(cameras.queryByText('Sony α7 IV')).not.toBeInTheDocument()

    fireEvent.click(
      cameras.getByRole('button', { name: 'Show 1 retired camera' })
    )

    const row = cameras.getByRole('link', { name: 'Sony α7 IV' }).closest('tr')!
    expect(within(row).getByText('retired')).toBeVisible()
    expect(within(row).getByText('Mar 2022 to Feb 2024')).toBeVisible()
    expect(within(row).getByText('188')).toBeVisible()

    fireEvent.click(
      cameras.getByRole('button', { name: 'Hide 1 retired camera' })
    )
    expect(cameras.queryByText('Sony α7 IV')).not.toBeInTheDocument()
  })

  it('says so when a kind has no gear', async () => {
    mockGetGears.mockResolvedValue([createGear()])
    render(<GalleryGearListView />)

    const lenses = await getSection('Lenses')
    expect(lenses.getByText('No lenses yet.')).toBeVisible()
    expect(lenses.getByText('0 active')).toBeVisible()
  })

  it('opens a gear’s page from the row', async () => {
    mockGetGears.mockResolvedValue([createGear()])
    render(<GalleryGearListView />)

    const cameras = await getSection('Cameras')
    expect(cameras.getByRole('link', { name: 'Sony α1' })).toHaveAttribute(
      'href',
      '/gallery/gear/cam-1'
    )
    fireEvent.click(
      cameras.getByRole('link', { name: 'Sony α1' }).closest('tr')!
    )

    expect(mockPush).toHaveBeenCalledWith('/gallery/gear/cam-1')
  })

  it('opens the add dialog for the section’s kind and reloads after a save', async () => {
    const { createGalleryGear } = await import('@/lib/client')
    vi.mocked(createGalleryGear).mockResolvedValue(lens)
    render(<GalleryGearListView />)

    const lenses = await getSection('Lenses')
    fireEvent.click(lenses.getByRole('button', { name: 'Add lens' }))
    expect(screen.getByRole('dialog', { name: 'Add a lens' })).toBeVisible()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'New lens' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save lens' }))

    await waitFor(() => expect(mockGetGears).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it('opens the edit dialog without opening the gear’s page', async () => {
    mockGetGears.mockResolvedValue([createGear()])
    render(<GalleryGearListView />)

    const cameras = await getSection('Cameras')
    fireEvent.click(cameras.getByRole('button', { name: 'Edit Sony α1' }))

    expect(screen.getByRole('dialog', { name: 'Edit camera' })).toBeVisible()
    expect(screen.getByLabelText('Name')).toHaveValue('Sony α1')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('shows an error with Retry, and retries', async () => {
    mockGetGears.mockRejectedValueOnce(new Error('Server on fire'))
    render(<GalleryGearListView />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Server on fire')

    mockGetGears.mockResolvedValueOnce([createGear()])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Sony α1')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
