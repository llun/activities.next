/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { uploadAttachment } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { ProfileImageField } from './ProfileImageField'

vi.mock('@/lib/client', () => ({ uploadAttachment: vi.fn() }))
vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn(async (file: File) => file)
}))
vi.mock('@/lib/components/instance-limits', () => ({
  useInstanceLimits: () => ({ maxMediaFileSize: 1000 })
}))

const mockUpload = uploadAttachment as jest.Mock
const MEDIA_URL = 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'

const renderField = (
  props: Partial<React.ComponentProps<typeof ProfileImageField>> = {}
) => {
  const onUrlChange = vi.fn()
  const onAltChange = vi.fn()
  const view = render(
    <ProfileImageField
      kind="avatar"
      url={null}
      alt=""
      initial="A"
      onUrlChange={onUrlChange}
      onAltChange={onAltChange}
      {...props}
    />
  )
  const fileInput = view.container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement
  return { ...view, onUrlChange, onAltChange, fileInput }
}

const choose = (input: HTMLInputElement, file: File) =>
  fireEvent.change(input, { target: { files: [file] } })

describe('ProfileImageField', () => {
  beforeEach(() => vi.clearAllMocks())

  it('names the avatar and header controls as the board does', () => {
    renderField({ kind: 'header' })

    expect(screen.getByText('Header image')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Change header' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alt text' })).toBeInTheDocument()
  })

  it('offers Remove only with an image', () => {
    const { rerender } = renderField()
    expect(screen.queryByRole('button', { name: 'Remove avatar' })).toBeNull()

    rerender(
      <ProfileImageField
        kind="avatar"
        url={MEDIA_URL}
        alt=""
        initial="A"
        onUrlChange={vi.fn()}
        onAltChange={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Remove avatar' })
    ).toBeInTheDocument()
  })

  it('removes the image and hands focus to Change', () => {
    const { onUrlChange } = renderField({ url: MEDIA_URL })

    fireEvent.click(screen.getByRole('button', { name: 'Remove avatar' }))

    expect(onUrlChange).toHaveBeenCalledWith(null)
    expect(screen.getByRole('button', { name: 'Change avatar' })).toHaveFocus()
  })

  it('uploads the picked file through the media upload and reports its URL', async () => {
    mockUpload.mockResolvedValue({ url: MEDIA_URL })
    const { fileInput, onUrlChange } = renderField()

    choose(fileInput, new File(['x'], 'me.png', { type: 'image/png' }))

    await waitFor(() => expect(onUrlChange).toHaveBeenCalledWith(MEDIA_URL))
    expect(fileInput.value).toBe('')
  })

  it('shows Uploading… and disables Change while it runs', async () => {
    const pending = createDeferred<{ url: string }>()
    mockUpload.mockReturnValue(pending.promise)
    const { fileInput } = renderField()

    choose(fileInput, new File(['x'], 'me.png', { type: 'image/png' }))

    const button = await screen.findByRole('button', { name: 'Uploading…' })
    expect(button).toBeDisabled()
    await act(async () => pending.resolve({ url: MEDIA_URL }))
    expect(screen.getByRole('button', { name: 'Change avatar' })).toBeEnabled()
  })

  it('refuses a file that is not a JPEG or PNG without uploading it', async () => {
    const { fileInput, onUrlChange } = renderField()

    choose(fileInput, new File(['x'], 'me.gif', { type: 'image/gif' }))

    expect(
      await screen.findByText('Please select a JPEG or PNG image')
    ).toHaveAttribute('role', 'alert')
    expect(mockUpload).not.toHaveBeenCalled()
    expect(onUrlChange).not.toHaveBeenCalled()
  })

  it('refuses a file over the instance cap', async () => {
    const { fileInput } = renderField()

    choose(
      fileInput,
      new File([new Uint8Array(2000)], 'big.png', { type: 'image/png' })
    )

    expect(
      await screen.findByText(/Image is too large\. Maximum size is/)
    ).toBeInTheDocument()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('keeps the old image when an upload fails', async () => {
    mockUpload.mockRejectedValue(new Error('boom'))
    const { fileInput, onUrlChange } = renderField({ url: MEDIA_URL })

    choose(fileInput, new File(['x'], 'me.png', { type: 'image/png' }))

    expect(
      await screen.findByText('Failed to upload image. Please try again.')
    ).toBeInTheDocument()
    expect(onUrlChange).not.toHaveBeenCalled()
  })

  it('shows the save’s message for the image', () => {
    renderField({ imageError: 'Invalid iconUrl' })

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid iconUrl')
  })

  it('keeps alt text behind its button, open when there already is some', () => {
    const closed = renderField()
    expect(closed.container.querySelector('textarea')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Avatar alt text' }))
    expect(closed.container.querySelector('textarea')).toBeVisible()
    closed.unmount()

    const open = renderField({ alt: 'A smiling woman' })
    expect(open.container.querySelector('textarea')).toBeVisible()
  })

  it('reports alt text edits and limits them to 1500 characters', () => {
    const { onAltChange, container } = renderField({ alt: 'x' })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: 'xy' } })

    expect(onAltChange).toHaveBeenCalledWith('xy')
    expect(textarea).toHaveAttribute('maxlength', '1500')
  })

  it('opens the alt text when an error for it arrives later', () => {
    const { rerender } = renderField()
    const panel = () =>
      screen.getByLabelText('Avatar alt text', { selector: 'textarea' })
        .parentElement as HTMLElement
    expect(panel()).toHaveAttribute('hidden')

    rerender(
      <ProfileImageField
        kind="avatar"
        url={null}
        alt=""
        initial="A"
        altError="Invalid avatarDescription"
        onUrlChange={vi.fn()}
        onAltChange={vi.fn()}
      />
    )

    expect(panel()).not.toHaveAttribute('hidden')
    expect(
      screen.getByRole('button', { name: 'Avatar alt text' })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('tells the page while a file is uploading', async () => {
    const pending = createDeferred<{ url: string }>()
    mockUpload.mockReturnValue(pending.promise)
    const onUploadingChange = vi.fn()
    const { fileInput } = renderField({ onUploadingChange })

    choose(fileInput, new File(['x'], 'me.png', { type: 'image/png' }))
    await waitFor(() => expect(onUploadingChange).toHaveBeenCalledWith(true))
    expect(onUploadingChange).not.toHaveBeenCalledWith(false)

    await act(async () => pending.resolve({ url: MEDIA_URL }))
    expect(onUploadingChange).toHaveBeenLastCalledWith(false)
  })

  it('shows the save’s message for the alt text and marks the field', () => {
    const { container } = renderField({ altError: 'Invalid avatarDescription' })

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).toHaveAccessibleDescription('Invalid avatarDescription')
  })
})
