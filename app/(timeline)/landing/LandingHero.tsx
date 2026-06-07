import { Activity, Globe, Shield } from 'lucide-react'
import Image from 'next/image'
import { FC } from 'react'

interface LandingHeroProps {
  serviceName: string
}

/**
 * Left column of the logged-out landing when the server has no public posts to
 * preview: a copy-light brand hero on the Activity-orange ground with the
 * signature dual-tint orange gradient and a watermark sparrow mark.
 */
export const LandingHero: FC<LandingHeroProps> = ({ serviceName }) => (
  <div
    className="relative flex h-full min-h-[60vh] flex-col justify-between overflow-hidden px-7 py-10 text-white sm:px-14 sm:py-14"
    style={{
      backgroundColor: 'var(--primary)',
      backgroundImage:
        'radial-gradient(700px 420px at 18% 8%, hsl(24 95% 56%), transparent 60%),' +
        'radial-gradient(680px 520px at 100% 100%, hsl(24 95% 38%), transparent 55%)'
    }}
  >
    {/* Oversized faint mark, watermark style. */}
    <Image
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={540}
      height={540}
      className="pointer-events-none absolute -bottom-32 -right-32 h-auto w-[360px] select-none opacity-[0.12] sm:w-[540px]"
    />

    <div className="relative flex items-center gap-3">
      <Image
        src="/logo.png"
        alt=""
        aria-hidden="true"
        width={44}
        height={44}
        className="h-11 w-11 rounded-full object-contain ring-2 ring-white/70"
      />
      <span className="text-xl font-semibold tracking-tight">
        {serviceName}
      </span>
    </div>

    <div className="relative mt-10">
      <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[52px]">
        See what&apos;s
        <br />
        happening next.
      </h1>
      <p className="mt-4 max-w-sm text-[15px] leading-[1.5] text-white/90 sm:text-[17px]">
        Posts and fitness activity, on a server you own.
      </p>
    </div>

    <div className="relative mt-10 flex items-center gap-5 text-[13px] text-white/90">
      <span className="inline-flex items-center gap-1.5">
        <Globe className="size-[15px]" /> Fediverse
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Shield className="size-[15px]" /> Self-hosted
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Activity className="size-[15px]" /> Fitness
      </span>
    </div>
  </div>
)
