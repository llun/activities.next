import Image from 'next/image'
import Link from 'next/link'

interface LogoProps {
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
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
    <Link
      href="/"
      aria-label="Activities home"
      className={`inline-flex items-center gap-2 font-semibold tracking-tight ${sizes[size]} ${className}`}
    >
      <Image
        src="/logo-nav.png"
        alt=""
        aria-hidden="true"
        width={32}
        height={32}
        className="h-8 w-8 shrink-0 object-contain"
      />
      {showText && <span>Activities</span>}
    </Link>
  )
}
