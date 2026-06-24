'use client'

import { Check, Link as LinkIcon } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'

interface CopyLinkButtonProps {
  url: string
}

/**
 * The only interactive affordance on the public shared page: copy its own URL.
 */
export const CopyLinkButton: FC<CopyLinkButtonProps> = ({ url }) => {
  const { copied, copy } = useCopyToClipboard()

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => copy(url)}>
      {copied ? (
        <Check className="size-4 text-green-600 dark:text-green-500" />
      ) : (
        <LinkIcon className="size-4" />
      )}
      {copied ? 'Link copied' : 'Copy link'}
    </Button>
  )
}
