/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, renderHook, waitFor } from '@testing-library/react'

import {
  getTranslationCapability,
  getTranslationLanguages,
  translateStatus
} from '@/lib/client'
import { Translation } from '@/lib/types/mastodon/translation'

import { useStatusTranslation } from './translation-context'

jest.mock('@/lib/client', () => ({
  translateStatus: jest.fn(),
  getTranslationCapability: jest.fn(),
  getTranslationLanguages: jest.fn()
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
    jest.clearAllMocks()
    ;(getTranslationCapability as jest.Mock).mockResolvedValue({
      enabled: true,
      defaultLanguage: 'en'
    })
    ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
      de: ['en', 'es']
    })
  })

  it('ignores an out-of-order response from a superseded target', async () => {
    const resolvers: Record<string, (value: Translation) => void> = {}
    ;(translateStatus as jest.Mock).mockImplementation(
      ({ language }: { language: string }) =>
        new Promise<Translation>((resolve) => {
          resolvers[language] = resolve
        })
    )

    const { result } = renderHook(() => useStatusTranslation('id-1', 'de'))
    await waitFor(() => expect(result.current.canTranslate).toBe(true))

    // Kick off English, then immediately switch to Spanish — both in flight.
    act(() => result.current.request('en'))
    act(() => result.current.request('es'))
    expect(result.current.state).toBe('loading')

    // The superseded English request resolves last; it must not flip the UI.
    act(() => resolvers.en(makeTranslation('en')))
    expect(result.current.state).toBe('loading')

    // The latest target (Spanish) wins and drives the visible state.
    act(() => resolvers.es(makeTranslation('es')))
    await waitFor(() => expect(result.current.state).toBe('translated'))
    expect(result.current.target).toBe('es')
    expect(result.current.translation?.language).toBe('es')
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
})
