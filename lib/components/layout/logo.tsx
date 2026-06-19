import Image from 'next/image'
import Link from 'next/link'

interface LogoProps {
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
  // Server callers can pass an absolute URL (e.g. built from ACTIVITIES_HOST) so
  // the logo resolves against the canonical origin behind a CDN alias. Client
  // callers omit it and use the root-relative default.
  src?: string
}

const sizes = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-2xl'
}

export function Logo({
  showText = true,
  size = 'md',
  className = '',
  src = '/logo-nav.png'
}: LogoProps) {
  return (
    <Link
      href="/"
      aria-label="Activities home"
      className={`inline-flex items-center gap-2 font-semibold tracking-tight ${sizes[size]} ${className}`}
    >
      <Image
        src={src}
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
