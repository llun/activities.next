/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResizableMapContainer } from '@/lib/components/map/ResizableMapContainer'

describe('ResizableMapContainer', () => {
  it('renders children at defaultHeight initially', () => {
    const { container } = render(
      <ResizableMapContainer defaultHeight={288}>
        <div>Map Content</div>
      </ResizableMapContainer>
    )

    const mapArea = container.querySelector('.relative.w-full.shrink-0')
    expect(mapArea).toHaveStyle({ height: '288px' })
    expect(screen.getByText('Map Content')).toBeInTheDocument()
  })

  it('toggles between defaultHeight and expandedHeight via quick toggle button', () => {
    const { container } = render(
      <ResizableMapContainer defaultHeight={288} expandedHeight={560}>
        <div>Map Content</div>
      </ResizableMapContainer>
    )

    const mapArea = container.querySelector('.relative.w-full.shrink-0')
    const toggleBtn = screen.getByRole('button', { name: 'Expand map' })
    expect(toggleBtn).toBeInTheDocument()
    expect(mapArea).toHaveStyle({ height: '288px' })

    // Click to expand
    fireEvent.click(toggleBtn)
    expect(mapArea).toHaveStyle({ height: '560px' })
    expect(
      screen.getByRole('button', { name: 'Minimize map' })
    ).toBeInTheDocument()

    // Click again to minimize back to default
    fireEvent.click(screen.getByRole('button', { name: 'Minimize map' }))
    expect(mapArea).toHaveStyle({ height: '288px' })
  })

  it('resizes smoothly with pointer dragging and bounds clamping', () => {
    const { container } = render(
      <ResizableMapContainer
        defaultHeight={300}
        minHeight={200}
        maxHeight={600}
      >
        <div>Map Content</div>
      </ResizableMapContainer>
    )

    const mapArea = container.querySelector('.relative.w-full.shrink-0')
    const handle = screen.getByRole('separator', { name: 'Resize map height' })

    // Mock pointer capture on element
    handle.setPointerCapture = vi.fn()
    handle.releasePointerCapture = vi.fn()

    // Start drag
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 })
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1)

    // Verify dragging shield overlay is active during drag
    expect(
      container.querySelector('.cursor-ns-resize.z-50')
    ).toBeInTheDocument()

    // Drag downwards (+150px)
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 250 })
    expect(mapArea).toHaveStyle({ height: '450px' })

    // Drag beyond maxHeight (+400px => 700px, clamped to 600px)
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 500 })
    expect(mapArea).toHaveStyle({ height: '600px' })

    // Drag upwards beyond minHeight (-200px => 100px, clamped to 200px)
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -100 })
    expect(mapArea).toHaveStyle({ height: '200px' })

    // Release drag
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1)

    // Verify dragging shield overlay is cleanly removed
    expect(
      container.querySelector('.cursor-ns-resize.z-50')
    ).not.toBeInTheDocument()
  })

  it('supports keyboard navigation on the resize handle', () => {
    const { container } = render(
      <ResizableMapContainer
        defaultHeight={300}
        minHeight={200}
        maxHeight={500}
      >
        <div>Map Content</div>
      </ResizableMapContainer>
    )

    const mapArea = container.querySelector('.relative.w-full.shrink-0')
    const handle = screen.getByRole('separator', { name: 'Resize map height' })

    // ArrowDown increases height by 24px
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(mapArea).toHaveStyle({ height: '324px' })

    // ArrowUp decreases height by 24px
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(mapArea).toHaveStyle({ height: '300px' })

    // End jumps to maxHeight
    fireEvent.keyDown(handle, { key: 'End' })
    expect(mapArea).toHaveStyle({ height: '500px' })

    // Home jumps to minHeight
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(mapArea).toHaveStyle({ height: '200px' })

    // Enter resets to defaultHeight
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(mapArea).toHaveStyle({ height: '300px' })
  })

  it('resets to defaultHeight on double clicking the handle', () => {
    const { container } = render(
      <ResizableMapContainer defaultHeight={288} expandedHeight={560}>
        <div>Map Content</div>
      </ResizableMapContainer>
    )

    const mapArea = container.querySelector('.relative.w-full.shrink-0')
    const handle = screen.getByRole('separator', { name: 'Resize map height' })

    // Expand via toggle
    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }))
    expect(mapArea).toHaveStyle({ height: '560px' })

    // Double click handle to reset
    fireEvent.doubleClick(handle)
    expect(mapArea).toHaveStyle({ height: '288px' })
  })
})
