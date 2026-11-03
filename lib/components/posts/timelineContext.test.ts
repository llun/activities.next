import { TimelineParentPreview } from '@/lib/types/domain/timeline'

import { initialTimelineContext, mergeTimelineContext } from './timelineContext'

const preview = (id: string, text = id) =>
  ({
    id,
    actor: { id: 'https://activities.local/users/llun', username: 'llun' },
    contentHtml: text,
    text
  }) as TimelineParentPreview

describe('initialTimelineContext', () => {
  it('starts from the server context, or an empty one without it', () => {
    const context = { ancestorsById: { a: preview('a') } }

    expect(initialTimelineContext(context)).toEqual(context)
    expect(initialTimelineContext(undefined)).toEqual({ ancestorsById: {} })
  })
})

describe('mergeTimelineContext', () => {
  it('keeps every earlier preview and adds the later page’s', () => {
    const merged = mergeTimelineContext(
      { ancestorsById: { a: preview('a') } },
      { ancestorsById: { b: preview('b') } }
    )

    expect(Object.keys(merged.ancestorsById)).toEqual(['a', 'b'])
  })

  it('takes the later page’s copy of a parent both pages carry', () => {
    const merged = mergeTimelineContext(
      { ancestorsById: { a: preview('a', 'old') } },
      { ancestorsById: { a: preview('a', 'new') } }
    )

    expect(merged.ancestorsById.a.text).toBe('new')
  })

  it.each([undefined, { ancestorsById: {} }])(
    'returns the same state for a page with no previews (%o)',
    (next) => {
      const previous = { ancestorsById: { a: preview('a') } }

      expect(mergeTimelineContext(previous, next)).toBe(previous)
    }
  )
})
