import { Metadata } from 'next'

import {
  FollowListPage,
  generateFollowListMetadata
} from '@/app/(timeline)/[actor]/FollowListPage'

interface Props {
  params: Promise<{ actor: string }>
}

export const generateMetadata = async (props: Props): Promise<Metadata> => {
  return generateFollowListMetadata({ ...props, direction: 'followers' })
}

const Page = async (props: Props) => {
  return FollowListPage({ ...props, direction: 'followers' })
}

export default Page
