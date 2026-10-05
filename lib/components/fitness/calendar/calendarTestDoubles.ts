/**
 * Test doubles for the calendar components' jsdom tests: jsdom lays nothing out
 * (every width is 0) and has no ResizeObserver, matchMedia or scrollIntoView,
 * so the tests supply the pieces the components read.
 */
import { act } from '@testing-library/react'
import { vi } from 'vitest'

import { DateKey } from '@/lib/fitness/calendar/localDay'

export const key = (value: string) => value as DateKey

/** The fixed "today" the calendar tests use: Sunday 4 October 2026. */
export const TODAY = key('2026-10-04')

const rect = (width: number, height = 0): DOMRect =>
  ({
    width,
    height,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({})
  }) as DOMRect

/**
 * Gives elements a width and a ResizeObserver that reports it.
 *
 * `width` is what the calendar roots (`data-slot` annual-calendar or
 * month-calendar) measure at mount; `resize()` delivers a new width to every
 * observed element, as the browser would after a layout change. Returns a
 * `restore()` for `afterEach`.
 */
export const stubElementWidth = (width: number) => {
  let current = width
  const observed = new Map<Element, (entries: ResizeObserverEntry[]) => void>()

  class ResizeObserverStub {
    constructor(
      private readonly callback: (entries: ResizeObserverEntry[]) => void
    ) {}
    observe(target: Element) {
      observed.set(target, this.callback)
    }
    unobserve(target: Element) {
      observed.delete(target)
    }
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)

  const measured = (element: Element) =>
    element.matches(
      '[data-slot="annual-calendar"], [data-slot="month-calendar"]'
    )

  const spy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return rect(measured(this) ? current : 0)
    })

  return {
    resize(next: number) {
      current = next
      act(() => {
        observed.forEach((callback, target) => {
          if (!measured(target)) return
          callback([{ target, contentRect: rect(next) } as ResizeObserverEntry])
        })
      })
    },
    restore() {
      spy.mockRestore()
      vi.unstubAllGlobals()
    }
  }
}

/** Sets prefers-reduced-motion for `window.matchMedia`. */
export const stubReducedMotion = (reduce: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false
      }) as MediaQueryList
  )
}
