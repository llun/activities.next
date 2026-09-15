/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, renderHook, waitFor } from '@testing-library/react'

import {
  getTranslationCapability,
  getTranslationLanguages,
  translateStatus
} from '@/lib/client'
import { type Deferred, createDeferred } from '@/lib/testing/deferred'
import { Translation } from '@/lib/types/mastodon/translation'

import { useStatusTranslation } from './translation-context'

vi.mock('@/lib/client', () => ({
  translateStatus: vi.fn(),
  getTranslationCapability: vi.fn(),
  getTranslationLanguages: vi.fn()
}))

const makeTranslation = (language: string): Translation => ({
  content: `<p>${language}</p>`,
  spoiler_text: '',
  language,
  media_attachments: [],
  poll: null,
  detected_source_language: 'de',
  provider: 'DeepL.com'
})

describe('useStatusTranslation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getTranslationCapability as jest.Mock).mockResolvedValue({
      enabled: true,
      defaultLanguage: 'en'
    })
    ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
      de: ['en', 'es']
    })
  })

  it('ignores an out-of-order response from a superseded target', async () => {
    const pending: Record<string, Deferred<Translation>> = {}
    ;(translateStatus as jest.Mock).mockImplementation(
      ({ language }: { language: string }) => {
        pending[language] = createDeferred<Translation>()
        return pending[language].promise
      }
    )

    const { result } = renderHook(() => useStatusTranslation('id-1', 'de'))
    await waitFor(() => expect(result.current.canTranslate).toBe(true))

    // Kick off English, then immediately switch to Spanish — both in flight.
    act(() => result.current.request('en'))
    act(() => result.current.request('es'))
    expect(result.current.state).toBe('loading')

    // The superseded English request resolves last; it must not flip the UI.
    act(() => pending.en.resolve(makeTranslation('en')))
    expect(result.current.state).toBe('loading')

    // The latest target (Spanish) wins and drives the visible state.
    act(() => pending.es.resolve(makeTranslation('es')))
    await waitFor(() => expect(result.current.state).toBe('translated'))
    expect(result.current.target).toBe('es')
    expect(result.current.translation?.language).toBe('es')
  })

  it('only offers backend-supported targets and leads with the default', async () => {
    ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
      de: ['fr', 'en', 'es']
    })
    const { result } = renderHook(() => useStatusTranslation('id-3', 'de'))
    await waitFor(() => expect(result.current.canTranslate).toBe(true))
    // Default language ('en') leads; the unsupported direction is never added.
    expect(result.current.options).toEqual(['en', 'fr', 'es'])
    expect(result.current.target).toBe('en')
  })

  it('does not offer the default language when the backend cannot translate into it', async () => {
    ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
      de: ['fr', 'es']
    })
    const { result } = renderHook(() => useStatusTranslation('id-4', 'de'))
    await waitFor(() => expect(result.current.canTranslate).toBe(true))
    // 'en' is the server default but not a supported target for 'de'.
    expect(result.current.options).toEqual(['fr', 'es'])
    expect(result.current.options).not.toContain('en')
    expect(result.current.target).toBe('fr')
  })

  it('falls back to the default target when no pairs are advertised', async () => {
    ;(getTranslationLanguages as jest.Mock).mockResolvedValue({})
    const { result } = renderHook(() => useStatusTranslation('id-5', 'de'))
    await waitFor(() => expect(result.current.canTranslate).toBe(true))
    expect(result.current.options).toEqual(['en'])
    expect(result.current.target).toBe('en')
  })

  it('caches each target so re-requesting it does not re-hit the backend', async () => {
    ;(translateStatus as jest.Mock).mockImplementation(
      ({ language }: { language: string }) =>
        Promise.resolve(makeTranslation(language))
    )

    const { result } = renderHook(() => useStatusTranslation('id-2', 'de'))
    await waitFor(() => expect(result.current.canTranslate).toBe(true))

    await act(async () => result.current.request('en'))
    await waitFor(() => expect(result.current.state).toBe('translated'))

    act(() => result.current.showOriginal())
    expect(result.current.state).toBe('idle')

    await act(async () => result.current.request('en'))
    await waitFor(() => expect(result.current.state).toBe('translated'))
    expect(translateStatus).toHaveBeenCalledTimes(1)
  })

  it('supports unknown source language and gathers targets across all pairs', async () => {
    ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
      nl: ['en', 'fr'],
      es: ['en', 'de']
    })
    const { result } = renderHook(() =>
      useStatusTranslation('id-unknown', null)
    )
    await waitFor(() => expect(result.current.canTranslate).toBe(true))

    expect(result.current.canTranslate).toBe(true)
    expect(result.current.canManualTranslate).toBe(false)
    // All unique targets across pairs, with default language ('en') first
    expect(result.current.options).toEqual(['en', 'fr', 'de'])
    expect(result.current.target).toBe('en')
    expect(result.current.detectedSource).toBeNull()
  })

  it('suppresses inline translate but offers manual translate for same-language posts', async () => {
    ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
      en: ['es', 'de', 'fr']
    })
    const { result } = renderHook(() => useStatusTranslation('id-same', 'en'))
    await waitFor(() => expect(result.current.canManualTranslate).toBe(true))

    expect(result.current.canTranslate).toBe(false)
    expect(result.current.canManualTranslate).toBe(true)
    expect(result.current.options).toEqual(['es', 'de', 'fr'])
    expect(result.current.target).toBe('es')
  })

  it('suppresses both inline and manual translate for same-language post when no alternate targets exist', async () => {
    ;(getTranslationLanguages as jest.Mock).mockResolvedValue({})
    const { result } = renderHook(() =>
      useStatusTranslation('id-same-no-alt', 'en')
    )
    await waitFor(() => expect(getTranslationCapability).toHaveBeenCalled())

    expect(result.current.canTranslate).toBe(false)
    expect(result.current.canManualTranslate).toBe(false)
    expect(result.current.options).toEqual([])
    expect(result.current.target).toBeNull()
  })

  it('does not fetch capability or languages when enabled is false', async () => {
    const { result } = renderHook(() =>
      useStatusTranslation('id-disabled', 'nl', false)
    )
    expect(result.current.canTranslate).toBe(false)
    expect(result.current.canManualTranslate).toBe(false)
    expect(getTranslationCapability).not.toHaveBeenCalled()
    expect(getTranslationLanguages).not.toHaveBeenCalled()
  })
})
