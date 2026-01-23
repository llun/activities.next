import { Attachment } from '../../models/attachment'

interface MetaData {
  width: number
  height: number
}

interface BaseMedia {
  actorId: string
  original: {
    path: string
    bytes: number
    mimeType: string
    metaData: MetaData
    fileName?: string
  }
  thumbnail?: {
    path: string
    bytes: number
    mimeType: string
    metaData: MetaData
  }
  description?: string
}

export interface Media extends BaseMedia {
  id: string
}

export interface MediaWithStatus extends Media {
  statusId?: string
}

export interface PaginatedMediaWithStatus {
  items: MediaWithStatus[]
  total: number
}

export type CreateMediaParams = BaseMedia

export type CreateAttachmentParams = {
  actorId: string
  statusId: string
  mediaType: string
  url: string
  width?: number
  height?: number
  name?: string
}
export type GetAttachmentsParams = {
  statusId: string
}
export type GetAttachmentsForActorParams = {
  actorId: string
  limit?: number
  maxCreatedAt?: number
}
export type GetMediasForAccountParams = {
  accountId: string
  limit?: number
  page?: number
  maxCreatedAt?: number
}
export type GetStorageUsageForAccountParams = {
  accountId: string
}
export type DeleteMediaParams = {
  mediaId: string
}
export type GetMediaByIdParams = {
  mediaId: string
  accountId: string
}

export interface MediaDatabase {
  createMedia(params: CreateMediaParams): Promise<Media | null>

  createAttachment(params: CreateAttachmentParams): Promise<Attachment>
  getAttachments(params: GetAttachmentsParams): Promise<Attachment[]>
  getAttachmentsForActor(
    params: GetAttachmentsForActorParams
  ): Promise<Attachment[]>
  getMediasWithStatusForAccount(
    params: GetMediasForAccountParams
  ): Promise<PaginatedMediaWithStatus>
  getMediaByIdForAccount(params: GetMediaByIdParams): Promise<Media | null>
  getStorageUsageForAccount(
    params: GetStorageUsageForAccountParams
  ): Promise<number>
  deleteMedia(params: DeleteMediaParams): Promise<boolean>
}
