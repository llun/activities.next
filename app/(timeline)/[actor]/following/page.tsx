import { Metadata } from 'next'

import {
  FollowListPage,
  generateFollowListMetadata
} from '@/app/(timeline)/[actor]/FollowListPage'

interface Props {
  params: Promise<{ actor: string }>
}

export const generateMetadata = async (props: Props): Promise<Metadata> => {
  return generateFollowListMetadata({ ...props, direction: 'following' })
}

const Page = async (props: Props) => {
  return FollowListPage({ ...props, direction: 'following' })
}

export default Page
