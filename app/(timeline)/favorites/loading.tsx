import { FC } from 'react'

import { PostFeedLoading } from '@/lib/components/posts/PostFeedLoading'

export const FavoritesLoading: FC = () => (
  <PostFeedLoading label="Loading favorites" titleWidth="w-24" />
)

export default FavoritesLoading
