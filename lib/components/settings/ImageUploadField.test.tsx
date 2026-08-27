/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { uploadAttachment } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { ImageUploadField } from './ImageUploadField'

vi.mock('@/lib/client', () => ({ uploadAttachment: vi.fn() }))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn(async (file: File) => file)
}))

vi.mock('@/lib/components/instance-limits', () => ({
  useInstanceLimits: () => ({ maxMediaFileSize: 1024 * 1024 })
}))

const MEDIA_URL = 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'

type UploadResult = Awaited<ReturnType<typeof uploadAttachment>>

// The component reads only `result.url`, so a full attachment is not needed to
// drive it — but the mock's return type is, hence the cast.
const uploadResult = { url: MEDIA_URL } as UploadResult

const getSubmittedValue = (container: HTMLElement, fieldName: string) =>
  container.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${fieldName}"]`
  )?.value

describe('ImageUploadField', () => {
  const renderField = (currentUrl: string | null) =>
    render(
      <ImageUploadField
        fieldName="iconUrl"
        currentUrl={currentUrl}
        label="Icon image"
        previewType="thumbnail"
      />
    )

  it('shows the stored URL in a read-only field', () => {
    // The routes behind this field only accept a URL naming media this
    // instance already stores, which is what the upload button produces. A
    // typeable box would invite a remote URL the server refuses.
    renderField(MEDIA_URL)

    const input = screen.getByLabelText('Icon image')
    expect(input).toHaveValue(MEDIA_URL)
    expect(input).toHaveAttribute('readonly')
  })

  it('submits the stored URL unchanged', () => {
    const { container } = renderField(MEDIA_URL)

    expect(getSubmittedValue(container, 'iconUrl')).toBe(MEDIA_URL)
  })

  it('submits an empty value after the image is removed', () => {
    // Empty is how both profile routes are told to clear the stored image, so
    // losing the editable box must not lose the ability to clear.
    const { container } = renderField(MEDIA_URL)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Icon image' }))

    expect(getSubmittedValue(container, 'iconUrl')).toBe('')
  })

  it('moves focus to Upload when Remove unmounts itself', () => {
    // Remove renders only while a value is set, so clearing unmounts the
    // button that was just activated. A focused element removed from the
    // document drops focus to `<body>`, which sends the next Tab back to the
    // top of the page (WCAG 2.4.3).
    renderField(MEDIA_URL)

    const removeButton = screen.getByRole('button', {
      name: 'Remove Icon image'
    })
    removeButton.focus()
    expect(document.activeElement).toBe(removeButton)

    fireEvent.click(removeButton)

    expect(
      screen.queryByRole('button', { name: 'Remove Icon image' })
    ).not.toBeInTheDocument()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Upload Icon image' })
    )
  })

  it('gives the read-only field a muted surface in both themes', () => {
    // `Input` styles `disabled` but not `readOnly`, so an unmuted box reads as
    // typeable beside the genuinely editable Name and Summary fields.
    //
    // Asserting the base class alone would not catch the bug this replaced:
    // `Input`'s own `dark:bg-input/30` outranks a bare `bg-muted` under this
    // project's `&:is(.dark *)` dark variant, so the field stayed
    // indistinguishable in dark mode. Naming the variant makes `twMerge` drop
    // the base, and its ABSENCE from the rendered class list is the only part
    // of that a jsdom test can see — a losing cascade is invisible here.
    renderField(MEDIA_URL)

    const input = screen.getByLabelText('Icon image')
    expect(input).toHaveClass('bg-muted')
    expect(input).toHaveClass('dark:bg-muted')
    expect(input.className).not.toContain('dark:bg-input')
  })

  it('returns focus to Upload after an upload re-enables it', async () => {
    // Both buttons are `disabled` while an upload runs, and in a real browser
    // disabling the element holding focus drops it to `<body>` — the same WCAG
    // 2.4.3 loss `handleRemoveClick` avoids, reached through the disable path.
    //
    // jsdom does NOT implement that blur (a focused button keeps focus when
    // disabled — verified directly), so asserting on the real cause here would
    // pass with the fix removed. The blur is driven explicitly instead, and
    // what is actually under test is the restoration: focus sitting on the body
    // when an upload finishes is returned to Upload.
    const deferred = createDeferred<UploadResult>()
    vi.mocked(uploadAttachment).mockReturnValue(deferred.promise)

    const { container } = renderField(null)
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'avatar.png', { type: 'image/png' })] }
    })

    // Focus is on the body for the duration, which is the state a real browser
    // leaves behind when it disables the button that held it.
    expect(document.activeElement).toBe(document.body)

    deferred.resolve(uploadResult)

    await waitFor(() =>
      expect(getSubmittedValue(container, 'iconUrl')).toBe(MEDIA_URL)
    )
    // Retried rather than asserted once, because the value landing does not
    // mean the focus effect has run. React mutates the DOM during the commit
    // and flushes passive effects afterwards, and `waitFor` polls a
    // MutationObserver — so the hidden input's new value is observable in
    // between, and a bare assertion here read `<body>` on CI while passing
    // every time locally.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Upload Icon image' })
      )
    )
  })

  it('leaves focus alone when the user moved elsewhere during an upload', async () => {
    // The effect only reclaims focus that fell to the body, so someone who
    // tabbed on while the upload ran is not yanked back to it.
    const deferred = createDeferred<UploadResult>()
    vi.mocked(uploadAttachment).mockReturnValue(deferred.promise)

    const { container } = renderField(null)
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    screen.getByRole('button', { name: 'Upload Icon image' }).focus()

    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'avatar.png', { type: 'image/png' })] }
    })

    elsewhere.focus()
    deferred.resolve(uploadResult)

    await waitFor(() =>
      expect(getSubmittedValue(container, 'iconUrl')).toBe(MEDIA_URL)
    )
    // Retrying is no use for an assertion that nothing happened — it passes on
    // the first poll — so this needs a barrier instead, and the value landing
    // is not one for the reason above. Without flushing the effect the test
    // still passes with the `document.body` guard deleted, i.e. it stops
    // guarding anything on exactly the runs where the timing bites.
    await act(async () => {})
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  it('offers no remove button when no image is set', () => {
    renderField(null)

    expect(
      screen.queryByRole('button', { name: 'Remove Icon image' })
    ).not.toBeInTheDocument()
  })

  it('names both icon-only buttons for assistive technology', () => {
    renderField(MEDIA_URL)

    expect(
      screen.getByRole('button', { name: 'Upload Icon image' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Icon image' })
    ).toBeInTheDocument()
  })
})
