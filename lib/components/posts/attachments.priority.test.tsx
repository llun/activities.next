/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'

import { Attachments, getPrioritizedAttachment } from './attachments'
import {
  BLURHASH,
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

const renderAttachments = (
  attachments: ReturnType<typeof buildAttachment>[],
  prioritizeMedia?: boolean
) =>
  render(
    <Attachments
      status={buildNoteStatus(attachments)}
      onMediaSelected={vi.fn()}
      prioritizeMedia={prioritizeMedia}
    />
  )

const picture = () =>
  buildAttachment({ width: 800, height: 600, blurhash: BLURHASH })

describe('Attachments prioritizeMedia', () => {
  it('leaves a single image default when not asked', () => {
    const { container } = renderAttachments([picture()])
    const image = container.querySelector('img')!
    expect(image).not.toHaveAttribute('fetchpriority')
    expect(image).not.toHaveAttribute('loading')
  })

  it('reveals a single image immediately, keeping the browser default loading', () => {
    const { container } = renderAttachments([picture()], true)
    const image = container.querySelector('img')!
    expect(image).not.toHaveAttribute('loading')
    expect(image).not.toHaveAttribute('fetchpriority')
    expect(image).toHaveClass('opacity-100')
  })

  it('reveals only the first image of a strip, eager only on that tile', () => {
    const { container } = renderAttachments(
      [picture(), picture(), picture()],
      true
    )
    const images = Array.from(container.querySelectorAll('img'))
    expect(images.map((image) => image.getAttribute('loading'))).toEqual([
      'eager',
      'lazy',
      'lazy'
    ])
    expect(container.querySelector('[fetchpriority]')).toBeNull()
    expect(
      images.map((image) => image.classList.contains('opacity-100'))
    ).toEqual([true, false, false])
  })

  it('keeps every strip image lazy when not asked', () => {
    const { container } = renderAttachments([picture(), picture()])
    const images = Array.from(container.querySelectorAll('img'))
    expect(images.every((i) => i.getAttribute('loading') === 'lazy')).toBe(true)
    expect(container.querySelector('[fetchpriority]')).toBeNull()
  })

  it('does not prioritize an animated GIF', () => {
    const gif = buildAttachment({
      mediaType: 'image/gif',
      width: 400,
      height: 300
    })
    const gifv = buildAttachment({
      mediaType: 'video/mp4',
      playbackType: 'gifv',
      width: 400,
      height: 300
    })
    expect(getPrioritizedAttachment([gif, picture()])).toBeUndefined()
    expect(getPrioritizedAttachment([gifv, picture()])).toBeUndefined()
    expect(getPrioritizedAttachment([picture()])).toBeDefined()
  })

  it('does not hand the priority to a later image when the first is a video', () => {
    const video = buildAttachment({
      mediaType: 'video/mp4',
      width: 400,
      height: 300
    })
    const later = picture()
    expect(getPrioritizedAttachment([video, later])).toBeUndefined()

    const { container } = renderAttachments([video, later], true)
    const image = container.querySelector('img')!
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).not.toHaveClass('opacity-100')
  })
})
