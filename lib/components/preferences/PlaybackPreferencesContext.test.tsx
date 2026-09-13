/**
 * @vitest-environment jsdom
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import { FC } from 'react'
import { describe, expect, it } from 'vitest'

import {
  PlaybackPreferencesProvider,
  usePlaybackPreferences
} from './PlaybackPreferencesContext'

describe('PlaybackPreferencesContext', () => {
  it('returns default value when rendered outside provider', () => {
    const { result } = renderHook(() => usePlaybackPreferences())
    expect(result.current.autoplayGifs).toBe(false)
  })

  it('provides initialAutoplayGifs from provider', () => {
    const wrapper: FC<{ children: React.ReactNode }> = ({ children }) => (
      <PlaybackPreferencesProvider actorId="act-1" initialAutoplayGifs={true}>
        {children}
      </PlaybackPreferencesProvider>
    )

    const { result } = renderHook(() => usePlaybackPreferences(), { wrapper })
    expect(result.current.autoplayGifs).toBe(true)
  })

  it('allows updating autoplayGifs state', () => {
    const wrapper: FC<{ children: React.ReactNode }> = ({ children }) => (
      <PlaybackPreferencesProvider actorId="act-1" initialAutoplayGifs={false}>
        {children}
      </PlaybackPreferencesProvider>
    )

    const { result } = renderHook(() => usePlaybackPreferences(), { wrapper })
    expect(result.current.autoplayGifs).toBe(false)

    act(() => {
      result.current.setAutoplayGifs(true)
    })

    expect(result.current.autoplayGifs).toBe(true)
  })

  it('resets state when actorId changes', () => {
    let currentActorId = 'actor-1'
    let initialAutoplay = true

    const TestComponent = () => {
      const { autoplayGifs, setAutoplayGifs } = usePlaybackPreferences()
      return (
        <div>
          <span data-testid="autoplay-state">{String(autoplayGifs)}</span>
          <button
            onClick={() => setAutoplayGifs(false)}
            data-testid="toggle-btn"
          >
            Toggle
          </button>
        </div>
      )
    }

    const { rerender } = render(
      <PlaybackPreferencesProvider
        actorId={currentActorId}
        initialAutoplayGifs={initialAutoplay}
      >
        <TestComponent />
      </PlaybackPreferencesProvider>
    )

    expect(screen.getByTestId('autoplay-state').textContent).toBe('true')

    // Modify local state
    act(() => {
      screen.getByTestId('toggle-btn').click()
    })
    expect(screen.getByTestId('autoplay-state').textContent).toBe('false')

    // Switch actor
    currentActorId = 'actor-2'
    initialAutoplay = true
    rerender(
      <PlaybackPreferencesProvider
        actorId={currentActorId}
        initialAutoplayGifs={initialAutoplay}
      >
        <TestComponent />
      </PlaybackPreferencesProvider>
    )

    // Should be re-seeded from initialAutoplay for actor-2
    expect(screen.getByTestId('autoplay-state').textContent).toBe('true')
  })
})
