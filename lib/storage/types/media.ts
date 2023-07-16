export type StorageType = 'fs' | 'object'

interface BaseMedia {
  actorId: string
  original: {
    storage: StorageType
    path: string
  }
  thumbnail?: {
    storage: StorageType
    path: string
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
