'use client'

import { useState } from 'react'

import { Button } from './button'

interface CopyButtonProps {
  text: string
  className?: string
}

export const CopyButton = ({ text, className }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
