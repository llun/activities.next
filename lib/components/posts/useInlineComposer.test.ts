/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'

import { StatusNote } from '@/lib/types/domain/status'

import { StatusComposerMode, useInlineComposer } from './useInlineComposer'

const makeStatus = (id: string) =>
  ({ id, actorId: 'actor-1' }) as unknown as StatusNote

describe('useInlineComposer', () => {
  it('starts with no active composer', () => {
    const { result } = renderHook(() => useInlineComposer())
    expect(result.current.active).toBeNull()
  })

  it.each<{ description: string; mode: StatusComposerMode }>([
    { description: 'reply', mode: 'reply' },
    { description: 'quote', mode: 'quote' },
    { description: 'edit', mode: 'edit' }
  ])('opens the $description composer for a status', ({ mode }) => {
    const { result } = renderHook(() => useInlineComposer())
    const status = makeStatus('status-1')

    act(() => {
      if (mode === 'reply') result.current.openReply(status)
      else if (mode === 'quote') result.current.openQuote(status)
      else result.current.openEdit(status)
    })

    expect(result.current.active).toEqual({ status, mode })
  })

  it('replaces the active composer when another opens', () => {
    const { result } = renderHook(() => useInlineComposer())

    act(() => result.current.openReply(makeStatus('status-1')))
    act(() => result.current.openQuote(makeStatus('status-2')))

    expect(result.current.active?.mode).toBe('quote')
    expect(result.current.active?.status.id).toBe('status-2')
  })

  it('closes the active composer', () => {
    const { result } = renderHook(() => useInlineComposer())

    act(() => result.current.openEdit(makeStatus('status-1')))
    act(() => result.current.close())

    expect(result.current.active).toBeNull()
  })
})
