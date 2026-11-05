import { FC } from 'react'

import { PostFeedLoading } from '@/lib/components/posts/PostFeedLoading'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

export const BookmarksLoading: FC = () => (
  <PostFeedLoading
    label="Loading bookmarks"
    titleWidth="w-28"
    // The "Manage folders" (or "New folder") button: `Button size="sm"`.
    actions={<SkeletonBar className="h-8 w-36 rounded-md" />}
  />
)

export default BookmarksLoading
