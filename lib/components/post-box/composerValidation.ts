import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { EditableStatus } from '@/lib/types/domain/status'

import {
  areAttachmentIdsEqualInOrder,
  getEditableStatusAttachments,
  getPreservedStatusAttachments
} from './composerAttachments'

export const getEditableStatusText = (status: EditableStatus): string =>
  status.text

export const isWithinLengthLimit = (
  value: string,
  maxLength: number
): boolean => value.length <= maxLength

export const hasNewPostContent = (
  value: string,
  extension: {
    attachments: Pick<PostBoxAttachment, 'id'>[]
    fitnessFile?: unknown
  },
  maxLength: number
): boolean =>
  isWithinLengthLimit(value, maxLength) &&
  (value.trim().length > 0 ||
    extension.attachments.length > 0 ||
    Boolean(extension.fitnessFile))

export const hasEditPostContent = (
  status: EditableStatus,
  value: string,
  extension: { attachments: Pick<PostBoxAttachment, 'id'>[] },
  maxLength: number
): boolean =>
  isWithinLengthLimit(value, maxLength) &&
  (value.trim().length > 0 ||
    extension.attachments.length > 0 ||
    getPreservedStatusAttachments(status.attachments).length > 0)

export interface EditDirtyOptions {
  editStatus?: EditableStatus | null
  value: string
  contentWarning?: string
  contentWarningVisible?: boolean
  attachments: Pick<PostBoxAttachment, 'id'>[]
}

export const isEditDirty = ({
  editStatus,
  value,
  contentWarning = '',
  contentWarningVisible = false,
  attachments
}: EditDirtyOptions): boolean => {
  if (!editStatus) return false
  const resolvedContentWarning = contentWarningVisible ? contentWarning : ''
  const originalSummary = editStatus.summary ?? ''
  return (
    value !== getEditableStatusText(editStatus) ||
    resolvedContentWarning !== originalSummary ||
    !areAttachmentIdsEqualInOrder(
      attachments,
      getEditableStatusAttachments(editStatus)
    )
  )
}

export interface EditSubmittableOptions extends EditDirtyOptions {
  maxLength: number
}

export const isEditSubmittable = (options: EditSubmittableOptions): boolean => {
  if (!options.editStatus) return false
  return (
    isEditDirty(options) &&
    hasEditPostContent(
      options.editStatus,
      options.value,
      { attachments: options.attachments },
      options.maxLength
    )
  )
}
