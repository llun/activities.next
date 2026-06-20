/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import {
  HeatmapRegionPicker,
  PickerRegion,
  toHeatmapRegion,
  withRegionIds
} from './HeatmapRegionPicker'

const worldValue: PickerRegion[] = [{ id: 'w1', type: 'world' }]

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

    fireEvent.click(
      screen.getByRole('button', { name: /Draw rectangle on map/i })
    )
    // Composer is open: the draw surface and the Add area button are present.
    expect(
      screen.getByRole('application', { name: /Draw a rectangle/i })
    ).toBeInTheDocument()
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

  it('removes a region when its remove button is clicked', () => {
    const onChange = vi.fn()
    render(<HeatmapRegionPicker value={worldValue} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Remove region/i }))
    expect(onChange).toHaveBeenCalledWith([])
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
