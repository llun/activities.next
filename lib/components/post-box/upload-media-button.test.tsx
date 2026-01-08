/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { PostBoxAttachment } from '@/lib/models/attachment'
import { MAX_ATTACHMENTS } from '@/lib/services/medias/constants'
import { logger } from '@/lib/utils/logger'
import { resizeImage } from '@/lib/utils/resizeImage'

import { UploadMediaButton } from './upload-media-button'

jest.mock('../../utils/resizeImage')
jest.mock('../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}))

const mockResizeImage = resizeImage as jest.MockedFunction<typeof resizeImage>
const mockLogger = logger as jest.Mocked<typeof logger>

describe('UploadMediaButton', () => {
  const mockOnAddAttachment = jest.fn()
  const mockOnDuplicateError = jest.fn()
  const mockOnUploadStart = jest.fn()

  const createMockFile = (name: string, type = 'image/jpeg') => {
    return new File(['test'], name, { type })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockResizeImage.mockImplementation((file) => Promise.resolve(file))

    // Mock crypto.randomUUID
    let counter = 0
    global.crypto.randomUUID = jest.fn(() => `uuid-${counter++}`)

    // Mock URL.createObjectURL
    global.URL.createObjectURL = jest.fn(() => 'blob:test-url')
    global.URL.revokeObjectURL = jest.fn()
  })

  describe('MAX_ATTACHMENTS enforcement', () => {
    it('does not add files when attachment limit is reached', async () => {
      const existingAttachments: PostBoxAttachment[] = Array(MAX_ATTACHMENTS)
        .fill(null)
        .map((_, i) => ({
          type: 'upload',
          id: `existing-${i}`,
          mediaType: 'image/jpeg',
          url: `https://example.com/${i}.jpg`,
          width: 100,
          height: 100,
          name: `existing-${i}.jpg`
        }))

      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={existingAttachments}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const file = createMockFile('new-file.jpg')

      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockOnAddAttachment).not.toHaveBeenCalled()
      })
    })

    it('only adds files up to available slots', async () => {
      const existingAttachments: PostBoxAttachment[] = Array(8)
        .fill(null)
        .map((_, i) => ({
          type: 'upload',
          id: `existing-${i}`,
          mediaType: 'image/jpeg',
          url: `https://example.com/${i}.jpg`,
          width: 100,
          height: 100,
          name: `existing-${i}.jpg`
        }))

      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={existingAttachments}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const files = [
        createMockFile('file1.jpg'),
        createMockFile('file2.jpg'),
        createMockFile('file3.jpg')
      ]

      fireEvent.change(input, { target: { files } })

      await waitFor(() => {
        // Should only add 2 files (8 existing + 2 = 10 limit)
        expect(mockOnAddAttachment).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('duplicate file detection', () => {
    it('calls onDuplicateError when duplicate files are detected', async () => {
      const existingAttachments: PostBoxAttachment[] = [
        {
          type: 'upload',
          id: 'existing-1',
          mediaType: 'image/jpeg',
          url: 'https://example.com/duplicate.jpg',
          width: 100,
          height: 100,
          name: 'duplicate.jpg'
        }
      ]

      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={existingAttachments}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const files = [
        createMockFile('duplicate.jpg'),
        createMockFile('new-file.jpg')
      ]

      fireEvent.change(input, { target: { files } })

      await waitFor(() => {
        expect(mockOnDuplicateError).toHaveBeenCalledTimes(1)
        // Should only add the non-duplicate file
        expect(mockOnAddAttachment).toHaveBeenCalledTimes(1)
        expect(mockOnAddAttachment).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'new-file.jpg'
          })
        )
      })
    })

    it('does not call onDuplicateError when no duplicates exist', async () => {
      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={[]}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const file = createMockFile('new-file.jpg')

      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockOnDuplicateError).not.toHaveBeenCalled()
        expect(mockOnAddAttachment).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('async file processing', () => {
    it('awaits all file processing before completing', async () => {
      const processingOrder: string[] = []

      mockResizeImage.mockImplementation(async (file) => {
        processingOrder.push(`start-${file.name}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
        processingOrder.push(`end-${file.name}`)
        return file
      })

      mockOnAddAttachment.mockImplementation((attachment) => {
        processingOrder.push(`add-${attachment.name}`)
      })

      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={[]}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const files = [createMockFile('file1.jpg'), createMockFile('file2.jpg')]

      fireEvent.change(input, { target: { files } })

      await waitFor(() => {
        expect(mockOnAddAttachment).toHaveBeenCalledTimes(2)
      })

      // All files should be processed
      expect(processingOrder).toContain('start-file1.jpg')
      expect(processingOrder).toContain('end-file1.jpg')
      expect(processingOrder).toContain('add-file1.jpg')
      expect(processingOrder).toContain('start-file2.jpg')
      expect(processingOrder).toContain('end-file2.jpg')
      expect(processingOrder).toContain('add-file2.jpg')
      expect(mockOnUploadStart).toHaveBeenCalled()
    })

    it('handles errors in file processing gracefully', async () => {
      mockResizeImage
        .mockRejectedValueOnce(new Error('Failed to resize'))
        .mockResolvedValueOnce(createMockFile('file2.jpg'))

      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={[]}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const files = [createMockFile('file1.jpg'), createMockFile('file2.jpg')]

      fireEvent.change(input, { target: { files } })

      await waitFor(() => {
        expect(mockResizeImage).toHaveBeenCalledTimes(2)
      })

      // Only the successful file should be added
      expect(mockOnAddAttachment).toHaveBeenCalledTimes(1)
      expect(mockOnAddAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'file2.jpg'
        })
      )

      // Error should be logged with logger.error
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          fileName: 'file1.jpg',
          fileType: 'image/jpeg'
        }),
        'Failed to process file'
      )
    })
  })

  describe('attachment creation', () => {
    it('creates attachment with correct properties', async () => {
      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={[]}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const file = createMockFile('test.jpg', 'image/jpeg')

      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockOnAddAttachment).toHaveBeenCalledWith({
          type: 'upload',
          id: expect.any(String),
          mediaType: 'image/jpeg',
          url: 'blob:test-url',
          width: 0,
          height: 0,
          name: 'test.jpg',
          file: expect.any(File)
        })
      })
    })
  })

  describe('component visibility', () => {
    it('renders button when media upload is enabled', () => {
      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={[]}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      expect(screen.getByText('Add media')).toBeInTheDocument()
    })

    it('does not render when media upload is disabled', () => {
      const { container } = render(
        <UploadMediaButton
          isMediaUploadEnabled={false}
          attachments={[]}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('displays attachment count correctly', () => {
      const attachments: PostBoxAttachment[] = [
        {
          type: 'upload',
          id: '1',
          mediaType: 'image/jpeg',
          url: 'https://example.com/1.jpg',
          width: 100,
          height: 100,
          name: 'file1.jpg'
        },
        {
          type: 'upload',
          id: '2',
          mediaType: 'image/jpeg',
          url: 'https://example.com/2.jpg',
          width: 100,
          height: 100,
          name: 'file2.jpg'
        }
      ]

      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={attachments}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      )

      expect(screen.getByText(`2/${MAX_ATTACHMENTS}`)).toBeInTheDocument()
    })
  })
})
