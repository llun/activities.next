'use client'

import { useState } from 'react'

import { Button } from './button'

interface CopyButtonProps {
  text: string
  className?: string
}

export const CopyButton = ({ text, className }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!navigator || !navigator.clipboard || !navigator.clipboard.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Silently ignore copy failures to avoid misleading "Copied!" state
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleCopy}
      className={className}
    >
      {copied ? 'Copied!' : 'Copy'}
    </Button>
  )
}
