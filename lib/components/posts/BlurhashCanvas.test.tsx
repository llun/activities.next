/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlurhashCanvas } from './BlurhashCanvas'

// A real blurhash from a stored image, and two that a remote actor could put on
// a federated note: both pass `isValidBlurhash`, which only checks the base83
// charset and a 6..100 length, and both throw inside `decode`, which derives
// the required length from the size flag in the first character.
const VALID_BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
const CHARSET_VALID_BUT_TOO_SHORT = 'aaaaaa'
const CHARSET_VALID_BUT_TOO_LONG = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA'

const stubCanvasContext = () => {
  const putImageData = vi.fn()
  const createImageData = vi.fn(
    (width: number, height: number) =>
      ({ data: new Uint8ClampedArray(width * height * 4) }) as ImageData
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createImageData,
    putImageData
  } as unknown as CanvasRenderingContext2D)
  return { createImageData, putImageData }
}

describe('BlurhashCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('paints the decoded pixels onto the canvas', () => {
    const { putImageData } = stubCanvasContext()

    render(<BlurhashCanvas blurhash={VALID_BLURHASH} />)

    expect(putImageData).toHaveBeenCalledTimes(1)
  })

  it('sizes the canvas from its props', () => {
    stubCanvasContext()

    const { container } = render(
      <BlurhashCanvas blurhash={VALID_BLURHASH} width={16} height={24} />
    )

    const canvas = container.querySelector('canvas')
    expect(canvas).toHaveAttribute('width', '16')
    expect(canvas).toHaveAttribute('height', '24')
  })

  // The reason this component's try/catch is load-bearing. `decode` throws on a
  // hash whose length does not match `4 + 2 * componentX * componentY`, derived
  // from its first character — and `isValidBlurhash`, the only check a
  // federated blurhash passes through before it is stored, never looks at that.
  //
  // There is no error boundary between a post and the root, so the nearest one
  // is `app/error.tsx`: an escaping throw replaces the entire page with the
  // error screen. One hostile attachment would take the whole timeline.
  it.each([
    {
      description: 'too short for its size flag',
      blurhash: CHARSET_VALID_BUT_TOO_SHORT
    },
    {
      description: 'too long for its size flag',
      blurhash: CHARSET_VALID_BUT_TOO_LONG
    }
  ])('survives a hash that is $description', ({ blurhash }) => {
    stubCanvasContext()

    expect(() => render(<BlurhashCanvas blurhash={blurhash} />)).not.toThrow()
  })

  it('still renders the canvas when the hash cannot be decoded', () => {
    const { putImageData } = stubCanvasContext()

    const { container } = render(
      <BlurhashCanvas blurhash={CHARSET_VALID_BUT_TOO_SHORT} />
    )

    // The element stays so the image keeps its reserved box; only the paint is
    // skipped, leaving an empty canvas rather than a missing one.
    expect(container.querySelector('canvas')).toBeInTheDocument()
    expect(putImageData).not.toHaveBeenCalled()
  })

  it('does not decode an empty hash', () => {
    const { putImageData } = stubCanvasContext()

    render(<BlurhashCanvas blurhash="" />)

    expect(putImageData).not.toHaveBeenCalled()
  })

  // `getContext` answers null in a browser that cannot give a 2d context, and
  // the decode runs before that check.
  it('survives a canvas with no 2d context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    expect(() =>
      render(<BlurhashCanvas blurhash={VALID_BLURHASH} />)
    ).not.toThrow()
  })

  it('is hidden from assistive technology', () => {
    stubCanvasContext()

    const { container } = render(<BlurhashCanvas blurhash={VALID_BLURHASH} />)

    expect(container.querySelector('canvas')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
  })
})
