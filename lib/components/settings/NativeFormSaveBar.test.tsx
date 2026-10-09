/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { Input } from '@/lib/components/ui/input'
import { Select } from '@/lib/components/ui/select'
import { Switch } from '@/lib/components/ui/switch'

import { ImageUploadField } from './ImageUploadField'
import { NativeFormSaveBar } from './NativeFormSaveBar'

vi.mock('@/lib/client', () => ({ uploadAttachment: vi.fn() }))

vi.mock('@/lib/components/instance-limits', () => ({
  useInstanceLimits: () => ({ maxMediaFileSize: 1024 * 1024 })
}))

const MEDIA_URL = 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'

// Radix measures the switch's hidden form input with a ResizeObserver, which
// jsdom does not have.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
})

const save = () => screen.getByRole('button', { name: 'Save' })

describe('NativeFormSaveBar', () => {
  it('starts clean: Save is disabled and the bar says nothing is unsaved', () => {
    render(
      <form>
        <Input aria-label="Name" name="name" defaultValue="Anna" />
        <NativeFormSaveBar />
      </form>
    )

    expect(save()).toBeDisabled()
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
  })

  it('is the form submit button', () => {
    render(
      <form>
        <NativeFormSaveBar />
      </form>
    )

    expect(save()).toHaveAttribute('type', 'submit')
  })

  it('enables Save and says Unsaved changes after typing in a field', () => {
    render(
      <form>
        <Input aria-label="Name" name="name" defaultValue="Anna" />
        <NativeFormSaveBar />
      </form>
    )

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Anna B' }
    })

    expect(save()).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('enables Save after a native select changes', () => {
    render(
      <form>
        <Select aria-label="Lines" name="lines" defaultValue="5">
          <option value="5">5 lines</option>
          <option value="10">10 lines</option>
        </Select>
        <NativeFormSaveBar />
      </form>
    )

    fireEvent.change(screen.getByLabelText('Lines'), {
      target: { value: '10' }
    })

    expect(save()).toBeEnabled()
  })

  it('enables Save when a switch is toggled on its own', () => {
    // A Radix Switch fires neither `input` nor `change` into its form, so this
    // is the edit the bar cannot see from those events alone.
    render(
      <form>
        <Switch aria-label="Manually approve followers" name="approve" />
        <NativeFormSaveBar />
      </form>
    )
    expect(save()).toBeDisabled()

    fireEvent.click(
      screen.getByRole('switch', { name: 'Manually approve followers' })
    )

    expect(save()).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('enables Save when a switch that starts on is turned off', () => {
    render(
      <form>
        <Switch aria-label="Approve" name="approve" defaultChecked />
        <NativeFormSaveBar />
      </form>
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Approve' }))

    expect(screen.getByRole('switch', { name: 'Approve' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(save()).toBeEnabled()
  })

  it('enables Save after an image is removed from an upload field', () => {
    // Removing swaps the hidden value without any user input event; the field
    // dispatches one so the bar notices.
    render(
      <form>
        <ImageUploadField
          fieldName="iconUrl"
          currentUrl={MEDIA_URL}
          label="Icon image"
          previewType="thumbnail"
        />
        <NativeFormSaveBar />
      </form>
    )
    expect(save()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Icon image' }))

    expect(save()).toBeEnabled()
  })

  it('shows the spinner and disables Save once the form is submitted', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Input aria-label="Name" name="name" defaultValue="Anna" />
        <NativeFormSaveBar />
      </form>
    )
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Anna B' }
    })

    fireEvent.click(save())

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(save()).toBeDisabled()
    expect(save().querySelector('[data-slot="spinner"]')).not.toBeNull()
  })

  it('stops showing the spinner when the page is restored from the back/forward cache', () => {
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <Input aria-label="Name" name="name" defaultValue="Anna" />
        <NativeFormSaveBar />
      </form>
    )
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Anna B' }
    })
    fireEvent.click(save())
    expect(save().querySelector('[data-slot="spinner"]')).not.toBeNull()

    act(() => {
      const event = new Event('pageshow') as PageTransitionEvent
      Object.defineProperty(event, 'persisted', { value: true })
      window.dispatchEvent(event)
    })

    expect(save().querySelector('[data-slot="spinner"]')).toBeNull()
    expect(save()).toBeEnabled()
  })

  it('leaves a fresh page load alone when pageshow is not from the cache', () => {
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <Input aria-label="Name" name="name" defaultValue="Anna" />
        <NativeFormSaveBar />
      </form>
    )
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Anna B' }
    })
    fireEvent.click(save())

    act(() => {
      window.dispatchEvent(new Event('pageshow'))
    })

    expect(save().querySelector('[data-slot="spinner"]')).not.toBeNull()
  })
})
