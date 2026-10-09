/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Attachments } from './attachments'
import {
  buildAttachment,
  buildNoteStatus,
  resetAttachmentTestState
} from './attachments.testUtils'

beforeEach(() => {
  resetAttachmentTestState()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Attachments', () => {
  // The indicator has been got wrong twice (an outset ring clipped by the
  // strip's overflow, then an inset ring painted under the opaque image), so
  // the outline spelling is pinned.
  it.each([
    { description: 'a lone picture', count: 1 },
    { description: 'a strip item', count: 2 }
  ])(
    'draws the focus outline of $description inside its border box',
    ({ count }) => {
      render(
        <Attachments
          status={buildNoteStatus(
            Array.from({ length: count }, () =>
              buildAttachment({ width: 800, height: 600 })
            )
          )}
          onMediaSelected={vi.fn()}
        />
      )

      const [item] = screen.getAllByRole('button', { name: /Open media/ })
      expect(item).toHaveClass(
        'focus-visible:outline-2',
        'focus-visible:-outline-offset-2',
        'focus-visible:outline-ring/50'
      )
      expect(item.className).not.toContain('focus-visible:ring-')
    }
  )

  describe('corner treatment & nested elements', () => {
    it.each([
      {
        description: 'rounds a lone picture on all four corners',
        sizes: [{ width: 800, height: 600 }],
        expectedCorners: ['rounded-2xl']
      },
      {
        description: 'rounds only the outer edges of a two-item strip',
        sizes: [
          { width: 800, height: 600 },
          { width: 800, height: 600 }
        ],
        expectedCorners: ['rounded-l-2xl', 'rounded-r-2xl']
      },
      {
        description: 'leaves the middle of a three-item strip square',
        sizes: [
          { width: 800, height: 600 },
          { width: 600, height: 900 },
          { width: 1200, height: 500 }
        ],
        expectedCorners: ['rounded-l-2xl', 'rounded-none', 'rounded-r-2xl']
      },
      {
        description: 'leaves both middles of a four-item strip square',
        sizes: [
          { width: 800, height: 600 },
          { width: 600, height: 900 },
          { width: 600, height: 900 },
          { width: 1200, height: 500 }
        ],
        expectedCorners: [
          'rounded-l-2xl',
          'rounded-none',
          'rounded-none',
          'rounded-r-2xl'
        ]
      }
    ])('$description', ({ sizes, expectedCorners }) => {
      const items = sizes.map((size) => buildAttachment(size))
      const { container } = render(
        <Attachments
          status={buildNoteStatus(items)}
          onMediaSelected={vi.fn()}
        />
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(expectedCorners.length)
      const allCorners = [
        'rounded-2xl',
        'rounded-l-2xl',
        'rounded-r-2xl',
        'rounded-none'
      ]
      buttons.forEach((button, index) => {
        expect(button).toHaveClass(expectedCorners[index])
        allCorners
          .filter((corner) => corner !== expectedCorners[index])
          .forEach((other) => expect(button).not.toHaveClass(other))
      })

      const images = Array.from(container.querySelectorAll('img'))
      expect(images).toHaveLength(expectedCorners.length)
      images.forEach((image, index) => {
        expect(image).toHaveClass(expectedCorners[index])
      })
    })

    it.each([
      {
        description: 'rounds a lone video on all four corners',
        count: 1,
        expectedCorners: ['rounded-2xl']
      },
      {
        description: 'rounds only the outer edges of a three-video strip',
        count: 3,
        expectedCorners: ['rounded-l-2xl', 'rounded-none', 'rounded-r-2xl']
      }
    ])('$description', ({ count, expectedCorners }) => {
      const items = Array.from({ length: count }, () =>
        buildAttachment({ mediaType: 'video/mp4', width: 800, height: 600 })
      )
      const { container } = render(
        <Attachments
          status={buildNoteStatus(items)}
          onMediaSelected={vi.fn()}
        />
      )

      const videos = Array.from(container.querySelectorAll('video'))
      expect(videos).toHaveLength(expectedCorners.length)
      videos.forEach((video, index) => {
        expect(video).toHaveClass(expectedCorners[index])
        // The tile clipping the video carries the same corner.
        expect(video.parentElement).toHaveClass(expectedCorners[index])
      })
    })

    it('keeps natural widths across a four-item strip', () => {
      const items = [
        buildAttachment({ width: 800, height: 600 }),
        buildAttachment({ width: 600, height: 900 }),
        buildAttachment({ width: 600, height: 900 }),
        buildAttachment({ width: 1200, height: 500 })
      ]
      render(
        <Attachments
          status={buildNoteStatus(items)}
          onMediaSelected={vi.fn()}
        />
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(4)
      expect(buttons[0].parentElement?.style.width).toBe('320px')
      expect(buttons[1].parentElement?.style.width).toBe('160px')
      expect(buttons[2].parentElement?.style.width).toBe('160px')
      expect(buttons[3].parentElement?.style.width).toBe('576px')
    })
  })
})
