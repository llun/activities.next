import { FC } from 'react'

import { PageHeaderSkeleton, PostSkeleton } from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton hasDescription={false} />
      <div className="space-y-4">
        <PostSkeleton framed={true} />
        <PostSkeleton framed={true} hasMedia />
        <PostSkeleton framed={true} />
      </div>
    </div>
  )
}

export default Loading
