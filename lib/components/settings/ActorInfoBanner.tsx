import { FC } from 'react'

interface ActorInfoBannerProps {
  actorHandle: string
}

export const ActorInfoBanner: FC<ActorInfoBannerProps> = ({ actorHandle }) => {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/40">
      <p className="text-sm text-blue-900 dark:text-blue-200">
        All fitness imports will be saved to{' '}
        <span className="font-medium">{actorHandle}</span>
      </p>
    </div>
  )
}
