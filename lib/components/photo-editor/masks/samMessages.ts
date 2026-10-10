import type { MaskPoint } from '@/lib/services/medias/edit/recipe'

/** Messages to the segmentation worker. */
export type SamRequest =
  | { type: 'load'; encoder: ArrayBuffer; decoder: ArrayBuffer }
  | { type: 'embed'; bitmap: ImageBitmap }
  | { type: 'segment'; points: MaskPoint[] }

/** Messages from the segmentation worker. */
export type SamResponse =
  | { type: 'loaded' }
  | { type: 'embedded' }
  | { type: 'mask'; width: number; height: number; data: Uint8Array }
  | { type: 'error'; message: string }
