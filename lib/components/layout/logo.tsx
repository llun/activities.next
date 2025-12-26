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

const markSizes = {
  sm: 'h-7 w-7 text-sm',
  md: 'h-8 w-8 text-base',
  lg: 'h-9 w-9 text-lg'
}

export function Logo({
  showText = true,
  size = 'md',
  className = ''
}: LogoProps) {
  return (
    <Link
      href="/"
      aria-label="Activities home"
      className={`flex items-center gap-2 ${className}`}
    >
      {!showText && (
        <span
          className={`flex items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold ${markSizes[size]}`}
        >
          A
        </span>
      )}
      {showText && (
        <span className={`font-semibold tracking-tight ${textSizes[size]}`}>
          Activities
        </span>
      )}
    </Link>
  )
}
