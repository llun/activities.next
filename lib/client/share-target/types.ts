// The record `public/sw.js` writes when a Web Share Target POST arrives. The
// worker stages plain ArrayBuffers (never Blob/File, which WebKit and Chromium
// have historically failed to persist reliably) and the client rebuilds Files
// from them.
export interface StagedShareFile {
  name: string
  type: string
  lastModified: number
  size: number
  bytes: ArrayBuffer
}

export interface StagedShare {
  id: string
  createdAt: number
  title?: string
  text?: string
  url?: string
  files: StagedShareFile[]
  /** Files the worker refused before reading them (over its hard ceiling). */
  skipped?: number
}

/** The database the worker owns; the client only reads and deletes from it. */
export const SHARE_TARGET_DB_NAME = 'activities_share_target_v1'
export const SHARE_TARGET_STORE = 'shares'
export const SHARE_TARGET_TTL_MS = 24 * 60 * 60 * 1000
