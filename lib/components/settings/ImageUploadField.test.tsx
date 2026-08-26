/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { ImageUploadField } from './ImageUploadField'

vi.mock('@/lib/client', () => ({ uploadAttachment: vi.fn() }))

vi.mock('@/lib/components/instance-limits', () => ({
  useInstanceLimits: () => ({ maxMediaFileSize: 1024 * 1024 })
}))

const MEDIA_URL = 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'

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
