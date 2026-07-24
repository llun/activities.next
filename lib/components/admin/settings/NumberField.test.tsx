/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { NumberField } from './NumberField'

// The admin forms save over JSON, so the input's `max`/`min` attributes are
// never enforced by native form validation. Without a clamp a typed
// out-of-range value reaches the API and comes back as an opaque 422.
describe('NumberField', () => {
  const renderField = (value = 200) => {
    const onChange = vi.fn()
    render(
      <NumberField
        id="field"
        value={value}
        min={1}
        max={1024}
        onChange={onChange}
      />
    )
    return { input: screen.getByRole('spinbutton'), onChange }
  }

  it.each([
    { description: 'a value above max', typed: '2000', expected: 1024 },
    { description: 'a value below min', typed: '0', expected: 1 }
  ])('clamps $description on blur', ({ typed, expected }) => {
    const { input, onChange } = renderField()

    fireEvent.change(input, { target: { value: typed } })
    fireEvent.blur(input)

    expect(input).toHaveValue(expected)
    expect(onChange).toHaveBeenLastCalledWith(expected)
  })

  it('leaves an in-range value alone on blur', () => {
    const { input, onChange } = renderField()

    fireEvent.change(input, { target: { value: '500' } })
    fireEvent.blur(input)

    expect(input).toHaveValue(500)
    expect(onChange).toHaveBeenLastCalledWith(500)
  })

  it('restores the current value when the field is left empty', () => {
    const { input, onChange } = renderField(200)

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(input).toHaveValue(200)
    expect(onChange).not.toHaveBeenCalled()
  })
})
