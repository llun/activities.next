import { describe, expect, it } from 'vitest'

import {
  applyInheritedContext,
  inheritActivityPubContext
} from './inheritActivityPubContext'

describe('inheritActivityPubContext', () => {
  it('returns undefined when both parent and child context are undefined', () => {
    expect(inheritActivityPubContext(undefined, undefined)).toBeUndefined()
  })

  it('inherits parent context when child context is undefined', () => {
    expect(
      inheritActivityPubContext(
        'https://www.w3.org/ns/activitystreams',
        undefined
      )
    ).toBe('https://www.w3.org/ns/activitystreams')

    const parentObj = { toot: 'http://joinmastodon.org/ns#' }
    expect(inheritActivityPubContext(parentObj, undefined)).toEqual(parentObj)

    const parentArr = ['https://www.w3.org/ns/activitystreams', parentObj]
    expect(inheritActivityPubContext(parentArr, undefined)).toEqual(parentArr)
  })

  it('returns child context directly when parent context is undefined or null', () => {
    expect(
      inheritActivityPubContext(
        undefined,
        'https://www.w3.org/ns/activitystreams'
      )
    ).toBe('https://www.w3.org/ns/activitystreams')

    expect(
      inheritActivityPubContext(null, 'https://www.w3.org/ns/activitystreams')
    ).toBe('https://www.w3.org/ns/activitystreams')
  })

  it('resets inheritance when child context is explicitly null', () => {
    expect(
      inheritActivityPubContext('https://www.w3.org/ns/activitystreams', null)
    ).toBeNull()

    expect(
      inheritActivityPubContext(
        [
          'https://www.w3.org/ns/activitystreams',
          { rootTerm: 'https://example.com/ns#root' }
        ],
        null
      )
    ).toBeNull()
  })

  it('resets inheritance when child context array contains null', () => {
    const parentContext = [
      'https://www.w3.org/ns/activitystreams',
      { rootTerm: 'https://example.com/ns#root' }
    ]

    // [null] resets everything
    expect(inheritActivityPubContext(parentContext, [null])).toBeNull()

    // [null, { childTerm: '...' }] discards parent context and keeps childTerm
    expect(
      inheritActivityPubContext(parentContext, [
        null,
        { childTerm: 'https://example.com/ns#child' }
      ])
    ).toEqual({ childTerm: 'https://example.com/ns#child' })

    // [earlierChild, null, laterChild] discards parent context and earlier child definitions
    expect(
      inheritActivityPubContext(parentContext, [
        { discardedChild: 'https://example.com/ns#discarded' },
        null,
        { activeChild: 'https://example.com/ns#active' }
      ])
    ).toEqual({ activeChild: 'https://example.com/ns#active' })

    // Array ending in null resets everything
    expect(
      inheritActivityPubContext(parentContext, [
        { activeChild: 'https://example.com/ns#active' },
        null
      ])
    ).toBeNull()
  })

  it('preserves JSON-LD ordering where inherited definitions precede local definitions', () => {
    const parent = 'https://www.w3.org/ns/activitystreams'
    const child = { customTerm: 'https://example.com/ns#custom' }

    expect(inheritActivityPubContext(parent, child)).toEqual([
      'https://www.w3.org/ns/activitystreams',
      { customTerm: 'https://example.com/ns#custom' }
    ])
  })

  it('allows local definitions to override inherited definitions in array ordering', () => {
    const parent = [
      'https://www.w3.org/ns/activitystreams',
      { sharedTerm: 'https://example.com/ns#v1' }
    ]
    const child = [{ sharedTerm: 'https://example.com/ns#v2' }]

    const result = inheritActivityPubContext(parent, child)
    expect(result).toEqual([
      'https://www.w3.org/ns/activitystreams',
      { sharedTerm: 'https://example.com/ns#v1' },
      { sharedTerm: 'https://example.com/ns#v2' }
    ])
  })

  it('handles nested context arrays', () => {
    const parent = [['https://www.w3.org/ns/activitystreams']]
    const child = [[null, [{ childTerm: 'https://example.com/ns#child' }]]]

    expect(inheritActivityPubContext(parent, child)).toEqual({
      childTerm: 'https://example.com/ns#child'
    })
  })

  it('handles parent context with null reset', () => {
    const parent = [
      'https://discarded.example/ns',
      null,
      { rootTerm: 'https://example.com/root' }
    ]
    const child = { childTerm: 'https://example.com/child' }

    expect(inheritActivityPubContext(parent, child)).toEqual([
      { rootTerm: 'https://example.com/root' },
      { childTerm: 'https://example.com/child' }
    ])
  })
})

describe('applyInheritedContext', () => {
  it('attaches inherited context when child document omits @context', () => {
    const doc = { id: 'https://example.com/status/1', type: 'Note' }
    const parentContext = 'https://www.w3.org/ns/activitystreams'

    expect(applyInheritedContext(parentContext, doc)).toEqual({
      id: 'https://example.com/status/1',
      type: 'Note',
      '@context': 'https://www.w3.org/ns/activitystreams'
    })
  })

  it('removes @context if effective context resolves to undefined', () => {
    const doc = { id: 'https://example.com/status/1', type: 'Note' }
    expect(applyInheritedContext(undefined, doc)).toEqual({
      id: 'https://example.com/status/1',
      type: 'Note'
    })
  })

  it('sets @context to null when child explicitly resets inheritance', () => {
    const doc = {
      '@context': null,
      id: 'https://example.com/status/1',
      type: 'Note'
    }
    const parentContext = 'https://www.w3.org/ns/activitystreams'

    expect(applyInheritedContext(parentContext, doc)).toEqual({
      id: 'https://example.com/status/1',
      type: 'Note',
      '@context': null
    })
  })

  it('combines parent and child context on the document', () => {
    const doc = {
      '@context': { local: 'https://example.com/local' },
      id: 'https://example.com/status/1',
      type: 'Note'
    }
    const parentContext = 'https://www.w3.org/ns/activitystreams'

    expect(applyInheritedContext(parentContext, doc)).toEqual({
      id: 'https://example.com/status/1',
      type: 'Note',
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        { local: 'https://example.com/local' }
      ]
    })
  })
})
