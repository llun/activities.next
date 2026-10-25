import type { GetGalleryMediaOptions } from '@/lib/client/galleryMedia'

/**
 * The media-list options a filter state stands for. It lives outside
 * `filters/` so budgeted grids can take it as a prop type without importing
 * from the filter family; `filters/galleryMediaFilterState` re-exports it.
 */
export type GalleryMediaQuery = Pick<
  GetGalleryMediaOptions,
  'sort' | 'subject' | 'place' | 'takenFrom' | 'takenTo' | 'activityId'
>
