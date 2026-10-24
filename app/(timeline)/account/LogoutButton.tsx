'use client'

import { useState } from 'react'

import { SignOutDialog } from '@/lib/components/sign-out/SignOutDialog'
import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

export const LogoutButton = ({
  describedBy,
  labelledBy,
  className
}: {
  describedBy?: string
  labelledBy?: string
  className?: string
}) => {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn('sm:flex sm:justify-end', className)}>
      <Button
        variant="outline"
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        onClick={() => setOpen(true)}
      >
        Sign out
      </Button>
      <SignOutDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
