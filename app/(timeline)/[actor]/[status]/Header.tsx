'use client'

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'

interface Props {
  isActivity?: boolean
}

export const Header: FC<Props> = ({ isActivity = false }) => {
  const router = useRouter()

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/90 px-5 py-3 backdrop-blur">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => router.back()}
        className="h-8 w-8"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div>
        <h1 className="text-lg font-semibold">
          {isActivity ? 'Activity' : 'Post'}
        </h1>
        <p className="text-xs text-muted-foreground">
          {isActivity ? 'Fitness activity details' : 'Conversation thread'}
        </p>
      </div>
    </div>
  )
}
