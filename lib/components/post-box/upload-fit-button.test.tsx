/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import { UploadFitButton } from './upload-fit-button'

describe('UploadFitButton', () => {
  const mockOnSelectFitFile = jest.fn()
  const mockOnDuplicateError = jest.fn()
  const mockOnInvalidFileError = jest.fn()

  const createMockFile = (name: string, type = 'application/octet-stream') => {
    return new File(['fit-data'], name, { type })
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders when upload is enabled', () => {
    render(
      <UploadFitButton
        isMediaUploadEnabled={true}
        fitFile={null}
        onSelectFitFile={mockOnSelectFitFile}
        onDuplicateError={mockOnDuplicateError}
        onInvalidFileError={mockOnInvalidFileError}
      />
    )

    expect(screen.getByText('Add FIT')).toBeInTheDocument()
    expect(screen.getByText('0/1')).toBeInTheDocument()
  })

  it('does not render when upload is disabled', () => {
    const { container } = render(
      <UploadFitButton
        isMediaUploadEnabled={false}
        fitFile={null}
        onSelectFitFile={mockOnSelectFitFile}
        onDuplicateError={mockOnDuplicateError}
        onInvalidFileError={mockOnInvalidFileError}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('selects .fit file', () => {
    render(
      <UploadFitButton
        isMediaUploadEnabled={true}
        fitFile={null}
        onSelectFitFile={mockOnSelectFitFile}
        onDuplicateError={mockOnDuplicateError}
        onInvalidFileError={mockOnInvalidFileError}
      />
    )

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!
    const fitFile = createMockFile('morning-run.fit')

    fireEvent.change(input, { target: { files: [fitFile] } })

    expect(mockOnSelectFitFile).toHaveBeenCalledWith(fitFile)
    expect(mockOnDuplicateError).not.toHaveBeenCalled()
    expect(mockOnInvalidFileError).not.toHaveBeenCalled()
  })

  it('rejects unsupported file extension', () => {
    render(
      <UploadFitButton
        isMediaUploadEnabled={true}
        fitFile={null}
        onSelectFitFile={mockOnSelectFitFile}
        onDuplicateError={mockOnDuplicateError}
        onInvalidFileError={mockOnInvalidFileError}
      />
    )

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!
    const textFile = createMockFile('notes.txt', 'text/plain')

    fireEvent.change(input, { target: { files: [textFile] } })

    expect(mockOnInvalidFileError).toHaveBeenCalledTimes(1)
    expect(mockOnSelectFitFile).not.toHaveBeenCalled()
  })

  it('rejects duplicate file by name', () => {
    render(
      <UploadFitButton
        isMediaUploadEnabled={true}
        fitFile={createMockFile('duplicate.fit')}
        onSelectFitFile={mockOnSelectFitFile}
        onDuplicateError={mockOnDuplicateError}
        onInvalidFileError={mockOnInvalidFileError}
      />
    )

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!
    const duplicateFit = createMockFile('duplicate.fit')

    fireEvent.change(input, { target: { files: [duplicateFit] } })

    expect(mockOnDuplicateError).toHaveBeenCalledTimes(1)
    expect(mockOnSelectFitFile).not.toHaveBeenCalled()
  })
})
