/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import {
  DEFAULT_INSTANCE_LIMITS,
  InstanceLimitsProvider
} from '@/lib/components/instance-limits'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { logger } from '@/lib/utils/logger'
import { resizeImage } from '@/lib/utils/resizeImage'

import { UploadMediaButton } from './upload-media-button'

vi.mock('@/lib/utils/resizeImage')
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

const mockResizeImage = resizeImage as jest.MockedFunction<typeof resizeImage>
const mockLogger = logger as jest.Mocked<typeof logger>

describe('UploadMediaButton', () => {
  const mockOnAddAttachment = vi.fn()
  const mockOnDuplicateError = vi.fn()
  const mockOnUploadStart = vi.fn()
  const mockOnBeforeAddAttachments = vi.fn()

  const createMockFile = (name: string, type = 'image/jpeg') => {
    return new File(['test'], name, { type })
  }

  beforeEach(() => {
    vi.resetAllMocks()
    mockResizeImage.mockImplementation((file) => Promise.resolve(file))

    // Mock crypto.randomUUID
    let counter = 0
    global.crypto.randomUUID = vi.fn(() => `uuid-${counter++}`)

    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url')
    global.URL.revokeObjectURL = vi.fn()
  })

  const existingAttachments = (count: number): PostBoxAttachment[] =>
    Array.from({ length: count }, (_, index) => ({
      type: 'upload',
      id: `existing-${index}`,
      mediaType: 'image/jpeg',
      url: `https://example.com/${index}.jpg`,
      width: 100,
      height: 100,
      name: `existing-${index}.jpg`
    }))

  // The picker sizes itself to the instance's resolved
  // posts.maxMediaAttachments, so anything asserting on the cap has to render
  // inside a provider that publishes it.
  const renderButton = ({
    maxMediaAttachments,
    attachments
  }: {
    maxMediaAttachments?: number
    attachments: PostBoxAttachment[]
  }) =>
    render(
      <InstanceLimitsProvider maxMediaAttachments={maxMediaAttachments}>
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={attachments}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
        />
      </InstanceLimitsProvider>
    )

  describe('attachment limit enforcement', () => {
    it('does not add files when attachment limit is reached', async () => {
      renderButton({
        attachments: existingAttachments(
          DEFAULT_INSTANCE_LIMITS.maxMediaAttachments
        )
      })

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const file = createMockFile('new-file.jpg')

      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockOnAddAttachment).not.toHaveBeenCalled()
      })
    })

    it('only adds files up to available slots', async () => {
      renderButton({
        maxMediaAttachments: 10,
        attachments: existingAttachments(8)
      })

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const files = [
        createMockFile('file1.jpg'),
        createMockFile('file2.jpg'),
        createMockFile('file3.jpg')
      ]

      fireEvent.change(input, { target: { files } })

      await waitFor(() => {
        // Should only add 2 files (8 existing + 2 = the configured 10 limit)
        expect(mockOnAddAttachment).toHaveBeenCalledTimes(2)
      })
    })

    // The picker used to hard-code a build-time cap of 10, so an instance whose
    // admin raised posts.maxMediaAttachments still refused the 11th image.
    it('accepts more than ten files when the instance allows it', async () => {
      renderButton({ maxMediaAttachments: 20, attachments: [] })

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const files = Array.from({ length: 12 }, (_, index) =>
        createMockFile(`file${index}.jpg`)
      )

      fireEvent.change(input, { target: { files } })

      await waitFor(() => {
        expect(mockOnAddAttachment).toHaveBeenCalledTimes(12)
      })
    })

    it('stops at the configured limit when it is below ten', async () => {
      renderButton({
        maxMediaAttachments: 4,
        attachments: existingAttachments(4)
      })

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const file = createMockFile('new-file.jpg')

      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockOnUploadStart).toHaveBeenCalledTimes(1)
      })
      expect(mockOnAddAttachment).not.toHaveBeenCalled()
    })

    it('counts against the instance limit in its label and disabled state', () => {
      renderButton({
        maxMediaAttachments: 20,
        attachments: existingAttachments(11)
      })

      expect(
        screen.getByRole('button', { name: 'Add media (11/20)' })
      ).toBeEnabled()

      renderButton({
        maxMediaAttachments: 20,
        attachments: existingAttachments(20)
      })

      expect(
        screen.getByRole('button', { name: 'Add media (20/20)' })
      ).toBeDisabled()
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
            name: ''
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
    it('does not add processed files when the before-add hook returns false', async () => {
      mockOnBeforeAddAttachments.mockResolvedValue(false)

      render(
        <UploadMediaButton
          isMediaUploadEnabled={true}
          attachments={[]}
          onAddAttachment={mockOnAddAttachment}
          onDuplicateError={mockOnDuplicateError}
          onUploadStart={mockOnUploadStart}
          onBeforeAddAttachments={mockOnBeforeAddAttachments}
        />
      )

      const input =
        document.querySelector<HTMLInputElement>('input[type="file"]')!
      const file = createMockFile('file1.jpg')

      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockOnBeforeAddAttachments).toHaveBeenCalledTimes(1)
      })

      expect(mockResizeImage).toHaveBeenCalledTimes(1)
      expect(mockOnAddAttachment).not.toHaveBeenCalled()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url')
    })

    it('awaits all file processing before completing', async () => {
      const processingOrder: string[] = []

      mockResizeImage.mockImplementation(async (file) => {
        processingOrder.push(`start-${file.name}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
        processingOrder.push(`end-${file.name}`)
        return file
      })

      mockOnAddAttachment.mockImplementation((attachment) => {
        processingOrder.push(`add-${attachment.file?.name ?? attachment.name}`)
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
          name: ''
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
          name: '',
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

      expect(
        screen.getByRole('button', {
          name: `Add media (0/${DEFAULT_INSTANCE_LIMITS.maxMediaAttachments})`
        })
      ).toBeInTheDocument()
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

      expect(
        screen.getByRole('button', {
          name: `Add media (2/${DEFAULT_INSTANCE_LIMITS.maxMediaAttachments})`
        })
      ).toBeInTheDocument()
    })
  })
})
