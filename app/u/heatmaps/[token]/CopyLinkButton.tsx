'use client'

import { Check, Link as LinkIcon } from 'lucide-react'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'

interface CopyLinkButtonProps {
  url: string
}

/**
 * The only interactive affordance on the public shared page: copy its own URL.
 */
export const CopyLinkButton: FC<CopyLinkButtonProps> = ({ url }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    // navigator.clipboard is undefined in insecure (http) contexts and older
    // browsers; the button simply no-ops there (the link is also visible above).
    if (!navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be denied; nothing else to do.
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
      {copied ? (
        <Check className="size-4 text-green-600 dark:text-green-500" />
      ) : (
        <LinkIcon className="size-4" />
      )}
      {copied ? 'Link copied' : 'Copy link'}
    </Button>
  )
}
