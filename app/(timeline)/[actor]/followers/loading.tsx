import { FC } from 'react'

import { FollowListLoadingSkeleton } from '@/app/(timeline)/[actor]/FollowListLoadingSkeleton'

export const FollowersLoading: FC = () => (
  <FollowListLoadingSkeleton label="Loading followers" />
)

export default FollowersLoading
