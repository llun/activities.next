/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  adminCreateCustomEmoji,
  adminDeleteCustomEmoji,
  adminUpdateCustomEmoji
} from '@/lib/client'
import type { AdminCustomEmoji } from '@/lib/types/domain/customEmoji'

import { CustomEmojiManager } from './CustomEmojiManager'

vi.mock('@/lib/client', () => ({
  adminCreateCustomEmoji: vi.fn(),
  adminDeleteCustomEmoji: vi.fn(),
  adminUpdateCustomEmoji: vi.fn()
}))

const mockCreate = vi.mocked(adminCreateCustomEmoji)
const mockDelete = vi.mocked(adminDeleteCustomEmoji)
const mockUpdate = vi.mocked(adminUpdateCustomEmoji)

const emoji = (overrides: Partial<AdminCustomEmoji>): AdminCustomEmoji => ({
  id: 'e1',
  shortcode: 'blobcheer',
  url: 'https://llun.test/e1.png',
  static_url: 'https://llun.test/e1.png',
  visible_in_picker: true,
  category: null,
  disabled: false,
  ...overrides
})

const png = new File(['x'], 'cheer.png', { type: 'image/png' })

const chooseFile = (container: HTMLElement) => {
  const input = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement
  fireEvent.change(input, { target: { files: [png] } })
}

describe('CustomEmojiManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists the emoji by shortcode with a count', () => {
    render(
      <CustomEmojiManager
        initialEmojis={[
          emoji({ id: 'e2', shortcode: 'zeta' }),
          emoji({ id: 'e1', shortcode: 'alpha' })
        ]}
      />
    )

    expect(screen.getByText('2 uploaded')).toBeInTheDocument()
    const rows = within(
      screen.getByRole('list', { name: 'Custom emojis' })
    ).getAllByRole('listitem')
    expect(
      rows.map((row) => within(row).getByText(/^:\w+:$/).textContent)
    ).toEqual([':alpha:', ':zeta:'])
  })

  it('shows an empty state when none are uploaded', () => {
    render(<CustomEmojiManager initialEmojis={[]} />)

    expect(
      screen.getByText('No custom emoji uploaded yet.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Custom emojis' })).toBeNull()
  })

  it('marks a disabled emoji and one hidden from the picker', () => {
    render(
      <CustomEmojiManager
        initialEmojis={[emoji({ disabled: true, visible_in_picker: false })]}
      />
    )

    expect(screen.getByText('Disabled')).toBeInTheDocument()
    expect(screen.getByText('Hidden from picker')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument()
  })

  it('asks for an image before uploading', () => {
    render(<CustomEmojiManager initialEmojis={[]} />)

    fireEvent.change(screen.getByLabelText('Shortcode'), {
      target: { value: 'blobcheer' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload emoji' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose an image to upload.'
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects a shortcode with characters it cannot carry', () => {
    const { container } = render(<CustomEmojiManager initialEmojis={[]} />)

    chooseFile(container)
    fireEvent.change(screen.getByLabelText('Shortcode'), {
      target: { value: 'not ok!' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload emoji' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Shortcode may contain only letters, numbers, and underscores.'
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('uploads, adds the emoji to the list and says so', async () => {
    mockCreate.mockResolvedValue(emoji({ shortcode: 'blobcheer' }))
    const { container } = render(<CustomEmojiManager initialEmojis={[]} />)

    chooseFile(container)
    fireEvent.change(screen.getByLabelText('Shortcode'), {
      target: { value: 'blobcheer' }
    })
    fireEvent.change(screen.getByLabelText('Category (optional)'), {
      target: { value: ' cats ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload emoji' }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        shortcode: 'blobcheer',
        image: png,
        category: 'cats'
      })
    )
    expect(await screen.findByText('Added :blobcheer:')).toBeInTheDocument()
    expect(
      screen.getByRole('status').closest('[data-slot="alert"]')
    ).toHaveAttribute('data-tone', 'success')
    expect(screen.getByLabelText('Shortcode')).toHaveValue('')
    expect(screen.getByText('1 uploaded')).toBeInTheDocument()
  })

  it('shows the server error when the upload fails', async () => {
    mockCreate.mockRejectedValue(new Error('Shortcode already taken'))
    const { container } = render(<CustomEmojiManager initialEmojis={[]} />)

    chooseFile(container)
    fireEvent.change(screen.getByLabelText('Shortcode'), {
      target: { value: 'blobcheer' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload emoji' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Shortcode already taken'
    )
  })

  it('hides an emoji from the picker and shows the stored result', async () => {
    mockUpdate.mockResolvedValue(emoji({ visible_in_picker: false }))
    render(<CustomEmojiManager initialEmojis={[emoji({})]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        id: 'e1',
        visibleInPicker: false
      })
    )
    expect(await screen.findByText('Hidden from picker')).toBeInTheDocument()
  })

  it('saves a category when the field is left, and only if it changed', async () => {
    mockUpdate.mockResolvedValue(emoji({ category: 'cats' }))
    render(<CustomEmojiManager initialEmojis={[emoji({})]} />)
    const field = screen.getByLabelText('Category for :blobcheer:')

    fireEvent.blur(field)
    expect(mockUpdate).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: 'cats' } })
    fireEvent.blur(field)

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ id: 'e1', category: 'cats' })
    )
  })

  it('deletes an emoji, removes its row and says so', async () => {
    mockDelete.mockResolvedValue(undefined as never)
    render(<CustomEmojiManager initialEmojis={[emoji({})]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete :blobcheer:' }))

    expect(await screen.findByText('Deleted :blobcheer:')).toBeInTheDocument()
    expect(mockDelete).toHaveBeenCalledWith('e1')
    expect(screen.queryByRole('list', { name: 'Custom emojis' })).toBeNull()
  })
})
