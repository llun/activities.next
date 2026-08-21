import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { getPublicMapProvider } from '@/lib/config/mapProvider'

import { SharedHeatmapPage } from './SharedHeatmapPage'
import { loadSharedHeatmap } from './loadSharedHeatmap'
import {
  UNRESOLVED_SHARE_METADATA,
  buildSharedHeatmapMetadata
} from './sharedHeatmapMetadata'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

export const generateMetadata = async ({
  params
}: PageProps): Promise<Metadata> => {
  const { token } = await params
  const data = await loadSharedHeatmap(token)
  if (!data) return UNRESOLVED_SHARE_METADATA
  return buildSharedHeatmapMetadata(data)
}

const Page: FC<PageProps> = async ({ params }) => {
  const { token } = await params

  const data = await loadSharedHeatmap(token)
  if (!data) notFound()

  const mapProvider = getPublicMapProvider()

  return (
    <SharedHeatmapPage
      view={data.view}
      mapProvider={mapProvider}
      signupOpen={data.signupOpen}
      token={token}
      signinUrl="/auth/signin"
      signupUrl="/auth/signup"
    />
  )
}

export default Page
