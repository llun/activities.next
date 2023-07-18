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

interface BaseMedia {
  actorId: string
  original: {
    path: string
    bytes: number
    mimeType: string
  }
  thumbnail?: {
    path: string
    bytes: number
    mimeType: string
  }
  description?: string
}

export interface Media extends BaseMedia {
  id: string
}

export type CreateMediaParams = BaseMedia

export interface MediaStorage {
  createMedia(params: CreateMediaParams): Promise<Media | null>
}
