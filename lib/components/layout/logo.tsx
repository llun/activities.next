import Link from 'next/link'

interface LogoProps {
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const textSizes = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-2xl'
}

export function Logo({
  showText = true,
  size = 'md',
  className = ''
}: LogoProps) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`}>
      {showText && (
        <span
          className={`font-semibold tracking-tight ${textSizes[size]}`}
        >
          Activities
        </span>
      )}
    </Link>
  )
}
