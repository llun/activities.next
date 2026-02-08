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
        src="/logo.png"
        alt=""
        aria-hidden="true"
        width={24}
        height={24}
        className="h-[1em] w-[1em] shrink-0 object-contain"
      />
      {showText && <span>Activities</span>}
    </Link>
  )
}
