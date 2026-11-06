export const REMOTE_SIGNATURE_SCHEMES = ['cavage', 'rfc9421'] as const

export type RemoteSignatureScheme = (typeof REMOTE_SIGNATURE_SCHEMES)[number]

export const DEFAULT_EXPIRED_REMOTE_SIGNATURE_SCHEMES_PRUNE_LIMIT = 500

export type RemoteSignatureSchemeEntry = {
  domain: string
  scheme: RemoteSignatureScheme
  expiresAt: number
  createdAt: number
  updatedAt: number
}

export type GetRemoteSignatureSchemeParams = {
  domain: string
  now?: number | Date
}

export type UpsertRemoteSignatureSchemeParams = {
  domain: string
  scheme: RemoteSignatureScheme
  expiresAt: number | Date
  now?: number | Date
}

export type DeleteExpiredRemoteSignatureSchemesParams = {
  before?: number | Date
  limit?: number
}

export interface RemoteSignatureSchemeDatabase {
  getRemoteSignatureScheme(
    params: GetRemoteSignatureSchemeParams
  ): Promise<RemoteSignatureSchemeEntry | null>
  upsertRemoteSignatureScheme(
    params: UpsertRemoteSignatureSchemeParams
  ): Promise<void>
  deleteExpiredRemoteSignatureSchemes(
    params?: DeleteExpiredRemoteSignatureSchemesParams
  ): Promise<number>
}
