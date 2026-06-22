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
const rectValue: PickerRegion[] = [
  {
    id: 'rect-1',
    type: 'rect',
    name: 'Veluwe loop',
    nw: { lat: 52, lng: 5 },
    se: { lat: 51, lng: 6 }
  }
]

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

    fireEvent.click(screen.getByRole('button', { name: /Draw area on map/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /Draw area on map/i }))

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
    fireEvent.click(screen.getByRole('button', { name: /Draw area on map/i }))

    expect(mockLoadMapboxModule).toHaveBeenCalled()
    expect(mockLoadMaplibreModule).not.toHaveBeenCalled()
  })

  it('falls back to the coordinate fields when the map fails to load', async () => {
    mockLoadMaplibreModule.mockImplementationOnce(() =>
      Promise.reject(new Error('no map'))
    )
    render(<HeatmapRegionPicker value={[]} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Draw area on map/i }))

    expect(await screen.findByText(/Map unavailable/i)).toBeInTheDocument()
    // The coordinate fields (and Add area) remain usable as the manual fallback.
    expect(
      screen.getByRole('button', { name: /Add area/i })
    ).toBeInTheDocument()
  })

  it('clamps an out-of-range coordinate when the field commits', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Draw area on map/i }))
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

  it('keeps drawn rectangles when the whole world is added', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={rectValue} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Whole world/i }))
    const next = onChange.mock.calls[0][0] as PickerRegion[]
    // Each region owns its own heatmap now, so the two kinds coexist.
    expect(next).toHaveLength(2)
    expect(next.map((region) => region.type).sort()).toEqual(['rect', 'world'])
  })

  it('does not add a duplicate area with the same coordinates', () => {
    const onChange = vi.fn()
    // Same coords as the composer's DEFAULT_BOX (nw 53,3 / se 50,7).
    const existing: PickerRegion[] = [
      {
        id: 'rect-1',
        type: 'rect',
        nw: { lat: 53, lng: 3 },
        se: { lat: 50, lng: 7 }
      }
    ]
    render(<HeatmapRegionPicker value={existing} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Draw area on map/i }))
    fireEvent.click(screen.getByRole('button', { name: /Add area/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as PickerRegion[]
    // The duplicate is dropped — each region owns exactly one cached heatmap.
    expect(next).toHaveLength(1)
  })

  it('keeps the whole world when a rectangle is drawn', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={worldValue} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Draw area on map/i }))
    fireEvent.click(screen.getByRole('button', { name: /Add area/i }))
    const next = onChange.mock.calls[0][0] as PickerRegion[]
    expect(next).toHaveLength(2)
    expect(next.map((region) => region.type).sort()).toEqual(['rect', 'world'])
  })

  it('removes a region when its remove button is clicked', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={worldValue} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Remove region/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('fires onRegionRemoved with the removed region', () => {
    const onRegionRemoved = vi.fn()
    render(
      <HeatmapRegionPicker
        value={rectValue}
        onChange={vi.fn()}
        onRegionRemoved={onRegionRemoved}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Remove area/i }))
    expect(onRegionRemoved).toHaveBeenCalledTimes(1)
    expect(onRegionRemoved.mock.calls[0][0]).toMatchObject({ id: 'rect-1' })
  })

  it('fires onRegionSaved with the named area when a new area is added', () => {
    const onRegionSaved = vi.fn()
    render(
      <HeatmapRegionPicker
        value={[]}
        onChange={vi.fn()}
        onRegionSaved={onRegionSaved}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Draw area on map/i }))
    // Textbox order: Area name, NW latitude, NW longitude, SE latitude, SE longitude.
    const nameField = screen.getAllByRole('textbox')[0]
    fireEvent.change(nameField, { target: { value: 'Coastal ride' } })
    fireEvent.click(screen.getByRole('button', { name: /Add area/i }))

    expect(onRegionSaved).toHaveBeenCalledTimes(1)
    expect(onRegionSaved.mock.calls[0][0]).toMatchObject({
      type: 'rect',
      name: 'Coastal ride'
    })
  })

  it('fires onRegionSaved with the new label when an area is renamed', () => {
    const onRegionSaved = vi.fn()
    render(
      <HeatmapRegionPicker
        value={rectValue}
        onChange={vi.fn()}
        onRegionSaved={onRegionSaved}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Edit area/i }))
    const nameField = screen.getAllByRole('textbox')[0]
    fireEvent.change(nameField, { target: { value: 'Renamed loop' } })
    fireEvent.click(screen.getByRole('button', { name: /Save area/i }))

    expect(onRegionSaved).toHaveBeenCalledTimes(1)
    expect(onRegionSaved.mock.calls[0][0]).toMatchObject({
      id: 'rect-1',
      name: 'Renamed loop'
    })
  })

  it('labels the remove control per region kind (area vs region)', () => {
    render(<HeatmapRegionPicker value={rectValue} onChange={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /Remove area/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Edit area/i })
    ).toBeInTheDocument()
  })

  it('opens a region when its row is clicked', () => {
    const onOpen = vi.fn()
    render(
      <HeatmapRegionPicker
        value={worldValue}
        onChange={vi.fn()}
        onOpen={onOpen}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Open Whole world heatmap/i })
    )
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0]).toMatchObject({ id: 'w1', type: 'world' })
  })

  it('renders the per-region status atom from getRegionStatus', () => {
    render(
      <HeatmapRegionPicker
        value={worldValue}
        onChange={vi.fn()}
        onOpen={vi.fn()}
        getRegionStatus={() => ({
          state: 'completed',
          generatedLabel: '2h ago'
        })}
      />
    )
    expect(screen.getByText('Generated 2h ago')).toBeInTheDocument()
  })

  it('shows the generating status with a progress percent', () => {
    render(
      <HeatmapRegionPicker
        value={worldValue}
        onChange={vi.fn()}
        onOpen={vi.fn()}
        getRegionStatus={() => ({ state: 'generating', progressPercent: 42 })}
      />
    )
    expect(screen.getByText(/Generating… 42%/)).toBeInTheDocument()
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
