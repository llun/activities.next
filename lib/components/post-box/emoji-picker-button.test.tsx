/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import type { CustomEmoji } from '@/lib/types/mastodon/customEmoji'

import { EmojiPickerButton } from './emoji-picker-button'

const customEmojis: CustomEmoji[] = [
  {
    shortcode: 'blobcat',
    url: 'https://example.com/blobcat.png',
    static_url: 'https://example.com/blobcat.png',
    visible_in_picker: true,
    category: null
  }
]

describe('EmojiPickerButton', () => {
  it('inserts the :shortcode: token when a custom emoji is picked', () => {
    const onSelect = vi.fn()
    render(
      <EmojiPickerButton customEmojis={customEmojis} onSelect={onSelect} />
    )

    fireEvent.click(screen.getByLabelText('Add emoji or sticker'))
    // The Custom tab is the default when custom emoji exist.
    fireEvent.click(screen.getByLabelText('Insert :blobcat:'))

    expect(onSelect).toHaveBeenCalledWith(':blobcat: ')
  })

  it('inserts the unicode character when a system emoji is picked', () => {
    const onSelect = vi.fn()
    render(<EmojiPickerButton customEmojis={[]} onSelect={onSelect} />)

    fireEvent.click(screen.getByLabelText('Add emoji or sticker'))
    // Search surfaces system emoji across all groups.
    fireEvent.change(screen.getByLabelText('Search emoji and stickers'), {
      target: { value: 'grinning face' }
    })
    fireEvent.click(screen.getByLabelText('Insert grinning face'))

    expect(onSelect).toHaveBeenCalledWith('😀')
  })

  it('closes on Escape', () => {
    render(<EmojiPickerButton customEmojis={[]} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Add emoji or sticker'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
