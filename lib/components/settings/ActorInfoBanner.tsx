import { FC } from 'react'

import { Alert } from '@/lib/components/surface/Alert'

interface ActorInfoBannerProps {
  actorHandle: string
}

export const ActorInfoBanner: FC<ActorInfoBannerProps> = ({ actorHandle }) => (
  <Alert
    tone="info"
    title={
      <>
        All fitness imports will be saved to{' '}
        <span className="font-medium">{actorHandle}</span>
      </>
    }
  />
)
