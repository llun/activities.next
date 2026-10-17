/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { ComponentType, useState } from 'react'

import { createPreloadable } from '@/lib/components/lazy/createPreloadable'

interface Props {
  label: string
}

const Loaded: ComponentType<Props> = ({ label }) => (
  <div data-testid="loaded">{label}</div>
)
const Fallback: ComponentType<Props> = ({ label }) => (
  <div data-testid="dynamic">{label}</div>
)

describe('createPreloadable', () => {
  it('renders the dynamic component until preloaded', () => {
    const { Component } = createPreloadable(
      () => Promise.resolve(Loaded),
      Fallback
    )
    render(<Component label="hi" />)
    expect(screen.getByTestId('dynamic')).toHaveTextContent('hi')
    expect(screen.queryByTestId('loaded')).toBeNull()
  })

  it('renders the loaded component synchronously once preloaded', async () => {
    const { Component, preload } = createPreloadable(
      () => Promise.resolve(Loaded),
      Fallback
    )
    await act(async () => {
      await preload()
    })
    render(<Component label="hi" />)
    expect(screen.getByTestId('loaded')).toHaveTextContent('hi')
    expect(screen.queryByTestId('dynamic')).toBeNull()
  })

  it('keeps the dynamic path when the preload fails', async () => {
    const { Component, preload } = createPreloadable(
      () => Promise.reject(new Error('Loading chunk failed')),
      Fallback
    )
    await expect(preload()).resolves.toBeUndefined()
    render(<Component label="hi" />)
    expect(screen.getByTestId('dynamic')).toBeInTheDocument()
  })

  it('keeps a mounted instance on its implementation and state when the preload resolves', async () => {
    const mounts = vi.fn()
    const Counter: ComponentType<Props> = ({ label }) => {
      const [count, setCount] = useState(0)
      useState(() => mounts())
      return (
        <button data-testid="counter" onClick={() => setCount(count + 1)}>
          {label}:{count}
        </button>
      )
    }
    const { Component, preload } = createPreloadable(
      () => Promise.resolve(Counter),
      Counter
    )
    const { rerender } = render(<Component label="a" />)
    act(() => screen.getByTestId('counter').click())
    expect(screen.getByTestId('counter')).toHaveTextContent('a:1')

    await act(async () => {
      await preload()
    })
    rerender(<Component label="b" />)
    expect(screen.getByTestId('counter')).toHaveTextContent('b:1')
    expect(mounts).toHaveBeenCalledTimes(1)
  })

  it('does not remount a dynamic-path instance onto a different component', async () => {
    const { Component, preload } = createPreloadable(
      () => Promise.resolve(Loaded),
      Fallback
    )
    const { rerender } = render(<Component label="a" />)
    await act(async () => {
      await preload()
    })
    rerender(<Component label="b" />)
    expect(screen.getByTestId('dynamic')).toHaveTextContent('b')
    expect(screen.queryByTestId('loaded')).toBeNull()
  })

  it('loads once for repeated preloads and retries after a failure', async () => {
    const load = vi
      .fn<() => Promise<ComponentType<Props>>>()
      .mockRejectedValueOnce(new Error('Loading chunk failed'))
      .mockResolvedValue(Loaded)
    const { preload } = createPreloadable(load, Fallback)

    await Promise.all([preload(), preload(), preload()])
    expect(load).toHaveBeenCalledTimes(1)

    await preload()
    expect(load).toHaveBeenCalledTimes(2)

    await Promise.all([preload(), preload()])
    expect(load).toHaveBeenCalledTimes(2)
  })
})
