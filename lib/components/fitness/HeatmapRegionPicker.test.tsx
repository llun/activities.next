/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { loadMapboxModule } from '@/lib/utils/mapbox'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import {
  HeatmapRegionPicker,
  PickerRegion,
  toHeatmapRegion,
  withRegionIds
} from './HeatmapRegionPicker'

// The interactive map loaders never resolve here, so the composer stays on the
// "Loading map…" state and the coordinate fields drive the box deterministically
// (no real CDN/Mapbox/MapLibre script is injected in jsdom).
vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn(() => new Promise(() => {}))
}))
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright'
}))

const mockLoadMapboxModule = loadMapboxModule as jest.MockedFunction<
  typeof loadMapboxModule
>
const mockLoadMaplibreModule = loadMaplibreModule as jest.MockedFunction<
  typeof loadMaplibreModule
>

const worldValue: PickerRegion[] = [{ id: 'w1', type: 'world' }]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HeatmapRegionPicker', () => {
  it('renders the empty state when there are no regions', () => {
    render(<HeatmapRegionPicker value={[]} onChange={vi.fn()} />)
    expect(screen.getByText(/No regions yet/i)).toBeInTheDocument()
  })

  it('renders a whole-world region row and disables the world button', () => {
    render(<HeatmapRegionPicker value={worldValue} onChange={vi.fn()} />)
    // The row's unique description distinguishes it from the "Whole world" button.
    expect(
      screen.getByText(/Entire globe — every recorded activity/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Whole world/i })).toBeDisabled()
  })

  it('adds the whole world when the world button is clicked', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Whole world/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as PickerRegion[]
    expect(next).toHaveLength(1)
    expect(next[0].type).toBe('world')
  })

  it('adds a rectangle through the composer with the default box', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Select an area/i }))
    // Composer is open: the interactive map (here still loading) and the Add
    // area button are present.
    expect(screen.getByText(/Loading map/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add area/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as PickerRegion[]
    expect(next).toHaveLength(1)
    expect(toHeatmapRegion(next[0])).toMatchObject({
      type: 'rect',
      nw: { lat: 53, lng: 3 },
      se: { lat: 50, lng: 7 }
    })
  })

  it('uses the keyless MapLibre map when no Mapbox token is provided', () => {
    render(<HeatmapRegionPicker value={[]} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Select an area/i }))

    expect(mockLoadMaplibreModule).toHaveBeenCalled()
    expect(mockLoadMapboxModule).not.toHaveBeenCalled()
  })

  it('uses Mapbox when a public token is provided', () => {
    render(
      <HeatmapRegionPicker
        value={[]}
        onChange={vi.fn()}
        mapboxAccessToken="pk.test-token"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Select an area/i }))

    expect(mockLoadMapboxModule).toHaveBeenCalled()
    expect(mockLoadMaplibreModule).not.toHaveBeenCalled()
  })

  it('falls back to the coordinate fields when the map fails to load', async () => {
    mockLoadMaplibreModule.mockImplementationOnce(() =>
      Promise.reject(new Error('no map'))
    )
    render(<HeatmapRegionPicker value={[]} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Select an area/i }))

    expect(await screen.findByText(/Map unavailable/i)).toBeInTheDocument()
    // The coordinate fields (and Add area) remain usable as the manual fallback.
    expect(
      screen.getByRole('button', { name: /Add area/i })
    ).toBeInTheDocument()
  })

  it('clamps an out-of-range coordinate when the field commits', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Select an area/i }))
    // Textbox order: Area name, NW latitude, NW longitude, SE latitude, SE longitude.
    const nwLatitude = screen.getAllByRole('textbox')[1]
    fireEvent.change(nwLatitude, { target: { value: '99' } })
    fireEvent.blur(nwLatitude)
    fireEvent.click(screen.getByRole('button', { name: /Add area/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as PickerRegion[]
    // 99°N is clamped to the 90°N maximum.
    expect(toHeatmapRegion(next[0])).toMatchObject({
      type: 'rect',
      nw: { lat: 90 }
    })
  })

  it('replaces drawn rectangles when the whole world is selected', () => {
    const onChange = vi.fn()
    const rectValue: PickerRegion[] = [
      {
        id: 'rect-1',
        type: 'rect',
        nw: { lat: 52, lng: 5 },
        se: { lat: 51, lng: 6 }
      }
    ]
    render(<HeatmapRegionPicker value={rectValue} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Whole world/i }))
    const next = onChange.mock.calls[0][0] as PickerRegion[]
    expect(next).toHaveLength(1)
    expect(next[0].type).toBe('world')
  })

  it('drops the whole world when a rectangle is drawn', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={worldValue} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Select an area/i }))
    fireEvent.click(screen.getByRole('button', { name: /Add area/i }))
    const next = onChange.mock.calls[0][0] as PickerRegion[]
    expect(next).toHaveLength(1)
    expect(next[0].type).toBe('rect')
  })

  it('removes a region when its remove button is clicked', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={worldValue} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Remove region/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('labels the remove control per region kind (area vs region)', () => {
    const rectValue: PickerRegion[] = [
      {
        id: 'rect-1',
        type: 'rect',
        nw: { lat: 52, lng: 5 },
        se: { lat: 51, lng: 6 }
      }
    ]
    render(<HeatmapRegionPicker value={rectValue} onChange={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /Remove area/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Edit area/i })
    ).toBeInTheDocument()
  })
})

describe('withRegionIds', () => {
  it('attaches a stable id to each deserialized region', () => {
    const [region] = withRegionIds([{ type: 'world' }])
    expect(region.type).toBe('world')
    expect(typeof region.id).toBe('string')
    expect(region.id.length).toBeGreaterThan(0)
  })
})
