import { FC } from 'react'

import { PostFeedLoading } from '@/lib/components/posts/PostFeedLoading'

export const BookmarksLoading: FC = () => (
  <PostFeedLoading label="Loading bookmarks" titleWidth="w-28" />
)

export default BookmarksLoading
