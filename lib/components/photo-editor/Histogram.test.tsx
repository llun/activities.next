/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { computeHistogram } from '@/lib/components/photo-editor/engine/histogram'

import { Histogram } from './Histogram'
import { CLIP_OFF_COLOUR } from './histogramPalette'

const image = (rgb: [number, number, number], count = 1000) => {
  const data = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < count; i += 1) {
    data.set([...rgb, 255], i * 4)
  }
  return computeHistogram(data, count, 1)
}

const fillOf = (testId: string) =>
  screen.getByTestId(testId).querySelector('polygon')?.getAttribute('fill')

describe('Histogram', () => {
  it('draws R, G and B areas with screen blending and a luma outline', () => {
    render(<Histogram data={image([128, 128, 128])} />)
    for (const channel of ['r', 'g', 'b']) {
      const path = screen.getByTestId(`histogram-${channel}`)
      expect(path).toHaveClass('mix-blend-screen')
      expect(path).toHaveAttribute('fill-opacity', '0.75')
    }
    expect(screen.getByTestId('histogram-r')).toHaveAttribute(
      'fill',
      'rgb(235, 64, 64)'
    )
    const luma = screen.getByTestId('histogram-luma')
    expect(luma).toHaveAttribute('fill', 'none')
    expect(luma).toHaveAttribute('vector-effect', 'non-scaling-stroke')
    expect(screen.getAllByTestId('histogram-guide')).toHaveLength(3)
  })

  it('leaves both indicators off for a mid-grey image', () => {
    render(<Histogram data={image([128, 128, 128])} />)
    expect(screen.getByRole('img', { name: 'Histogram' })).toBeInTheDocument()
    expect(fillOf('histogram-clip-shadows')).toBe(CLIP_OFF_COLOUR)
    expect(fillOf('histogram-clip-highlights')).toBe(CLIP_OFF_COLOUR)
  })

  it.each([
    {
      description: 'white clips highlights in white',
      rgb: [255, 255, 255] as [number, number, number],
      highlight: 'rgb(240, 240, 240)',
      shadow: 'off',
      label: 'Histogram, highlights clipped'
    },
    {
      description: 'pure red clips highlights red and shadows cyan',
      rgb: [255, 0, 0] as [number, number, number],
      highlight: 'rgb(240, 32, 32)',
      shadow: 'rgb(32, 240, 240)',
      label: 'Histogram, shadows clipped, highlights clipped'
    },
    {
      description: 'yellow clips highlights yellow and shadows blue',
      rgb: [255, 255, 0] as [number, number, number],
      highlight: 'rgb(240, 240, 32)',
      shadow: 'rgb(32, 32, 240)',
      label: 'Histogram, shadows clipped, highlights clipped'
    },
    {
      description: 'black clips shadows in white',
      rgb: [0, 0, 0] as [number, number, number],
      highlight: 'off',
      shadow: 'rgb(240, 240, 240)',
      label: 'Histogram, shadows clipped'
    }
  ])('lights indicators: $description', ({ rgb, highlight, shadow, label }) => {
    render(<Histogram data={image(rgb)} />)
    expect(screen.getByRole('img', { name: label })).toBeInTheDocument()
    expect(fillOf('histogram-clip-shadows')).toBe(
      shadow === 'off' ? CLIP_OFF_COLOUR : shadow
    )
    expect(fillOf('histogram-clip-highlights')).toBe(
      highlight === 'off' ? CLIP_OFF_COLOUR : highlight
    )
  })

  it('hides the corner indicators from assistive technology', () => {
    render(<Histogram data={image([255, 255, 255])} />)
    for (const id of ['histogram-clip-shadows', 'histogram-clip-highlights']) {
      expect(screen.getByTestId(id)).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByTestId(id)).not.toHaveAttribute('role')
    }
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('renders only the frame and guides without data', () => {
    render(<Histogram data={null} />)
    expect(screen.getByRole('img', { name: 'Histogram' })).toBeInTheDocument()
    expect(screen.queryByTestId('histogram-r')).not.toBeInTheDocument()
    expect(screen.queryByTestId('histogram-luma')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('histogram-guide')).toHaveLength(3)
    expect(fillOf('histogram-clip-shadows')).toBe(CLIP_OFF_COLOUR)
    expect(fillOf('histogram-clip-highlights')).toBe(CLIP_OFF_COLOUR)
  })
})
