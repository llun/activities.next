// @vitest-environment jsdom
import { render } from '@testing-library/react'
import dynamic from 'next/dynamic'
import { createElement, useEffect } from 'react'
import { describe, expect, it } from 'vitest'

describe('vitest.setup timer guard', () => {
  it('guards window.setTimeout callers too', () => {
    expect(window.setTimeout).toBe(globalThis.setTimeout)
  })

  it('leaves a 0 ms timer armed without failing', () => {
    setTimeout(() => {}, 0)
  })

  it('does not fail when a 500 ms timer is cleared before the test ends', () => {
    const id = setTimeout(() => {}, 500)
    clearTimeout(id)
  })

  it('does not fail when a component clears its 500 ms timer on unmount', () => {
    function TimerOnMount() {
      useEffect(() => {
        const id = setTimeout(() => {}, 500)
        return () => clearTimeout(id)
      }, [])
      return null
    }
    // No cleanup() call of our own: @testing-library/react's own
    // afterEach(cleanup) unmounts the tree, and the guard has to check
    // after that, not before it.
    render(createElement(TimerOnMount))
  })

  it('leaves next/dynamic alone while its import is still loading', () => {
    const Pending = dynamic(() => new Promise<never>(() => {}))
    render(createElement(Pending))
  })

  // The guard's error fails the test, so it.fails is the honest shape. The
  // error message ("still armed" plus the arming stack) cannot be asserted
  // from here: onTestFinished handlers run in reverse registration order
  // (vitest hardcodes "stack" for them), so the guard's handler, registered
  // first in the setup file, always runs after anything this file registers.
  it.fails('fails when a 500 ms timer is left armed', () => {
    setTimeout(() => {}, 500)
  })

  it.fails('fails when a timer of exactly LONG_TIMER_MS is left armed', () => {
    setTimeout(() => {}, 100)
  })
})
