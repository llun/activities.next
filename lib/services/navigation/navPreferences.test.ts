import {
  DEFAULT_NAV_ORDER,
  type NavItemId,
  moveNavItem,
  moveNavItemTo,
  normalizedHidden,
  normalizedOrder,
  sanitizeNavHidden,
  sanitizeNavOrder,
  splitNav
} from '@/lib/services/navigation/navPreferences'

const allAvailable = new Set<NavItemId>(DEFAULT_NAV_ORDER)

describe('normalizedOrder', () => {
  it('returns the shipped order when the user has no preference', () => {
    expect(normalizedOrder({})).toEqual([...DEFAULT_NAV_ORDER])
  })

  it('drops ids this release no longer ships', () => {
    expect(
      normalizedOrder({ navOrder: ['settings', 'trends', 'timeline'] })
    ).toEqual([
      'settings',
      'timeline',
      ...DEFAULT_NAV_ORDER.filter(
        (id) => id !== 'settings' && id !== 'timeline'
      )
    ])
  })

  it('appends newly shipped items in their default order', () => {
    expect(normalizedOrder({ navOrder: ['search', 'timeline'] })).toEqual([
      'search',
      'timeline',
      ...DEFAULT_NAV_ORDER.filter((id) => id !== 'search' && id !== 'timeline')
    ])
  })

  it('keeps a repeated id once', () => {
    const order = normalizedOrder({
      navOrder: ['settings', 'settings', 'timeline']
    })
    expect(order.filter((id) => id === 'settings')).toHaveLength(1)
    expect(order).toHaveLength(DEFAULT_NAV_ORDER.length)
  })
})

describe('normalizedHidden', () => {
  it('is empty when the user hides nothing', () => {
    expect(normalizedHidden({})).toEqual([])
  })

  it('drops pinned and unknown ids', () => {
    expect(
      normalizedHidden({ navHidden: ['settings', 'trends', 'favorites'] })
    ).toEqual(['favorites'])
  })

  it('returns hidden ids in the user order', () => {
    expect(
      normalizedHidden({
        navOrder: ['bookmarks', 'favorites'],
        navHidden: ['favorites', 'bookmarks']
      })
    ).toEqual(['bookmarks', 'favorites'])
  })
})

describe('splitNav', () => {
  it('shows every available item in order when nothing is hidden', () => {
    expect(splitNav({}, allAvailable)).toEqual({
      shown: [...DEFAULT_NAV_ORDER],
      more: []
    })
  })

  it('moves hidden items into more, keeping their relative order', () => {
    const { shown, more } = splitNav(
      { navHidden: ['bookmarks', 'favorites'] },
      allAvailable
    )
    expect(shown).not.toContain('favorites')
    expect(more).toEqual(['favorites', 'bookmarks'])
  })

  it('leaves unavailable items out of both lists', () => {
    const availability = new Set(
      [...allAvailable].filter((id) => id !== 'fitness' && id !== 'admin')
    )
    const { shown, more } = splitNav({ navHidden: ['fitness'] }, availability)
    expect(shown).not.toContain('fitness')
    expect(more).not.toContain('fitness')
    expect([...shown, ...more]).not.toContain('admin')
  })

  it('follows the user order', () => {
    const { shown } = splitNav(
      { navOrder: ['settings', 'timeline'] },
      allAvailable
    )
    expect(shown.slice(0, 2)).toEqual(['settings', 'timeline'])
  })
})

describe('moveNavItem', () => {
  const visible = new Set<NavItemId>(DEFAULT_NAV_ORDER)

  it('swaps with the previous visible item', () => {
    const next = moveNavItem(DEFAULT_NAV_ORDER, visible, 'search', -1)
    expect(next.slice(0, 2)).toEqual(['search', 'timeline'])
  })

  it('swaps with the next visible item', () => {
    const next = moveNavItem(DEFAULT_NAV_ORDER, visible, 'timeline', 1)
    expect(next.slice(0, 2)).toEqual(['search', 'timeline'])
  })

  it('skips hidden items so they keep their slot', () => {
    // Explore is hidden, so moving Search down must swap it with Messages and
    // leave Explore sitting between them.
    const visibleWithoutExplore = new Set(
      [...DEFAULT_NAV_ORDER].filter((id) => id !== 'explore')
    )
    const next = moveNavItem(
      DEFAULT_NAV_ORDER,
      visibleWithoutExplore,
      'search',
      1
    )
    expect(next.slice(0, 4)).toEqual([
      'timeline',
      'messages',
      'explore',
      'search'
    ])
  })

  it.each([
    ['first', 'timeline' as NavItemId, -1 as const],
    ['last', 'settings' as NavItemId, 1 as const]
  ])('leaves the order untouched past the %s visible item', (_, id, dir) => {
    expect(moveNavItem(DEFAULT_NAV_ORDER, visible, id, dir)).toEqual([
      ...DEFAULT_NAV_ORDER
    ])
  })
})

describe('moveNavItemTo', () => {
  it('splices the dragged item into the target position', () => {
    const next = moveNavItemTo(DEFAULT_NAV_ORDER, 'settings', 'timeline')
    expect(next[0]).toBe('settings')
    expect(next[1]).toBe('timeline')
    expect(next).toHaveLength(DEFAULT_NAV_ORDER.length)
  })

  it('moves an item downwards', () => {
    const next = moveNavItemTo(DEFAULT_NAV_ORDER, 'timeline', 'explore')
    expect(next.slice(0, 3)).toEqual(['search', 'explore', 'timeline'])
  })

  it('returns the same order when dragged onto itself', () => {
    expect(moveNavItemTo(DEFAULT_NAV_ORDER, 'search', 'search')).toEqual([
      ...DEFAULT_NAV_ORDER
    ])
  })
})

describe('sanitizeNavOrder', () => {
  it('keeps known ids once, in the order given', () => {
    expect(
      sanitizeNavOrder(['settings', 'trends', 'settings', 'timeline'])
    ).toEqual(['settings', 'timeline'])
  })

  it('accepts an empty list as a reset', () => {
    expect(sanitizeNavOrder([])).toEqual([])
  })
})

describe('sanitizeNavHidden', () => {
  it('drops pinned ids so navigation can never strand the user', () => {
    expect(
      sanitizeNavHidden(['settings', 'timeline', 'favorites', 'trends'])
    ).toEqual(['favorites'])
  })
})
