import { Attachment } from '../../models/attachment'

export enum MediaStorageType {
  LocalFile = 'fs',
  ObjectStorage = 'object'
}

export type MediaStorageConfig =
  | {
      type: MediaStorageType.LocalFile
      path: string
    }
  | {
      type: MediaStorageType.ObjectStorage
      bucket: string
    }

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

export type CreateMediaParams = BaseMedia

export type CreateAttachmentParams = {
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

export interface MediaStorage {
  createMedia(params: CreateMediaParams): Promise<Media | null>

  createAttachment(params: CreateAttachmentParams): Promise<Attachment>
  getAttachments(params: GetAttachmentsParams): Promise<Attachment[]>
}
