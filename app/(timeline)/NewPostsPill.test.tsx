/**
 * @vitest-environment jsdom
 */
import { createUnseenAboveStore } from './NewPostsPill'

describe('createUnseenAboveStore', () => {
  let originalRect: typeof HTMLElement.prototype.getBoundingClientRect
  // Where each feed row's top sits on screen, by its row id attribute.
  let rowTops: Record<string, number>

  const renderRows = (rows: string[][]) => {
    document.body.innerHTML = rows
      .map((ids) => `<div data-row-status-ids="${ids.join(' ')}"></div>`)
      .join('')
  }

  beforeEach(() => {
    originalRect = HTMLElement.prototype.getBoundingClientRect
    rowTops = {}
    HTMLElement.prototype.getBoundingClientRect = function () {
      const top = rowTops[this.getAttribute('data-row-status-ids') ?? ''] ?? 0
      return { top, bottom: top + 100 } as DOMRect
    }
  })

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect
    document.body.innerHTML = ''
  })

  it('counts every new post of a thread row that is above the screen', () => {
    // A thread row shows its root first but sits where its newest reply is.
    renderRows([['root', 'reply-new'], ['new-b'], ['old']])
    rowTops = { 'root reply-new': -500, 'new-b': -200, old: 100 }
    const store = createUnseenAboveStore()
    store.add(['reply-new', 'new-b'])

    store.recount()
    expect(store.getCount()).toBe(2)

    rowTops = { 'root reply-new': -150, 'new-b': 150, old: 450 }
    store.recount()
    expect(store.getCount()).toBe(1)

    rowTops = { 'root reply-new': 0, 'new-b': 300, old: 600 }
    store.recount()
    expect(store.getCount()).toBe(0)
  })

  it('forgets a post once it has been on screen, even when it scrolls back above', () => {
    renderRows([['new-a'], ['old']])
    rowTops = { 'new-a': 120, old: 400 }
    const store = createUnseenAboveStore()
    store.add(['new-a'])
    store.recount()
    expect(store.getCount()).toBe(0)

    rowTops = { 'new-a': -400, old: -100 }
    store.recount()
    expect(store.getCount()).toBe(0)
  })

  it('keeps the count while no rows are rendered and notifies only on change', () => {
    const store = createUnseenAboveStore()
    const listener = vi.fn()
    store.subscribe(listener)

    renderRows([['new-a'], ['old']])
    rowTops = { 'new-a': -300, old: 100 }
    store.add(['new-a'])
    store.recount()
    expect(store.getCount()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)

    document.body.innerHTML = ''
    store.recount()
    store.recount()
    expect(store.getCount()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)

    store.clear()
    expect(store.getCount()).toBe(0)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
