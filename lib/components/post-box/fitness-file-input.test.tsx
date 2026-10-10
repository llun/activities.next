/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'

import { FitnessFileInput, FitnessFileInputHandle } from './fitness-file-input'

const fileInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement

const selectFile = (input: HTMLInputElement, file: File) => {
  fireEvent.change(input, { target: { files: [file] } })
}

describe('FitnessFileInput', () => {
  const onFileSelected = vi.fn()
  const onError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the hidden file picker when asked through its handle', () => {
    const ref = createRef<FitnessFileInputHandle>()
    const { container } = render(
      <FitnessFileInput
        ref={ref}
        onFileSelected={onFileSelected}
        onError={onError}
      />
    )
    const click = vi.spyOn(fileInput(container), 'click')

    ref.current?.open()

    expect(click).toHaveBeenCalledTimes(1)
  })

  it.each(['ride.fit', 'run.gpx', 'swim.tcx', 'RIDE.FIT', 'my.long.name.Gpx'])(
    'passes %s to onFileSelected',
    (name) => {
      const { container } = render(
        <FitnessFileInput onFileSelected={onFileSelected} onError={onError} />
      )
      const file = new File(['data'], name)

      selectFile(fileInput(container), file)

      expect(onFileSelected).toHaveBeenCalledWith(file)
      expect(onError).not.toHaveBeenCalled()
    }
  )

  it.each(['photo.png', 'notes.txt', 'noextension', 'archive.fit.zip'])(
    'rejects %s with an invalid file type message',
    (name) => {
      const { container } = render(
        <FitnessFileInput onFileSelected={onFileSelected} onError={onError} />
      )

      selectFile(fileInput(container), new File(['data'], name))

      expect(onError).toHaveBeenCalledWith(
        'Invalid file type. Please upload .fit, .gpx, .tcx files only.'
      )
      expect(onFileSelected).not.toHaveBeenCalled()
    }
  )

  it('ignores a change event with no file chosen', () => {
    const { container } = render(
      <FitnessFileInput onFileSelected={onFileSelected} onError={onError} />
    )

    fireEvent.change(fileInput(container), { target: { files: [] } })

    expect(onFileSelected).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('clears the input after a valid pick so the same file can be chosen again', () => {
    const { container } = render(
      <FitnessFileInput onFileSelected={onFileSelected} onError={onError} />
    )
    const input = fileInput(container)
    const setValue = vi.fn()
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => 'C:\\fakepath\\run.gpx',
      set: setValue
    })

    selectFile(input, new File(['data'], 'run.gpx'))

    expect(setValue).toHaveBeenCalledWith('')
  })
})
