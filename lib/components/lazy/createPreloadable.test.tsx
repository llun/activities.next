/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { ComponentType } from 'react'

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
})
