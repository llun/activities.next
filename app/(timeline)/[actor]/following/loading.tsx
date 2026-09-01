import { FC } from 'react'

import { FollowListLoadingSkeleton } from '@/app/(timeline)/[actor]/FollowListLoadingSkeleton'

export const FollowingLoading: FC = () => (
  <FollowListLoadingSkeleton label="Loading following" />
)

export default FollowingLoading
