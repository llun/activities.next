import { ExternalLink } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface ActorRedirectCardProps {
  host: string
  targetUrl: string
  domain: string
  username: string
}

export const ActorRedirectCard: FC<ActorRedirectCardProps> = ({
  host,
  targetUrl,
  domain,
  username
}) => {
  return (
    <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <div
        className={cn(
          'bg-card flex w-full flex-col items-center rounded-xl border px-[22px] py-7 text-center shadow-sm',
          'sm:max-w-[480px] sm:px-10 sm:py-11'
        )}
      >
        {/* Eyebrow pill */}
        <div className="bg-background text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
          <ExternalLink className="size-[13px]" aria-hidden="true" />
          <span>Redirect · external profile</span>
        </div>

        {/* Hero icon */}
        <div className="text-primary mb-1 mt-4 sm:mt-[22px]">
          <ExternalLink className="size-16 sm:size-[88px]" aria-hidden="true" />
        </div>

        {/* Title */}
        <h1 className="mt-3 text-xl font-semibold leading-[1.25] tracking-[-0.01em] text-pretty sm:mt-4 sm:text-2xl">
          You are leaving {host}
        </h1>

        {/* Body */}
        <p className="text-muted-foreground mt-2.5 max-w-[380px] text-sm leading-[1.6] text-pretty sm:text-[15px]">
          If you trust this link, click it to continue.
        </p>

        {/* Action button & target link */}
        <div className="mt-6 flex w-full flex-col items-center gap-3">
          <Button asChild className="w-full sm:w-auto">
            <a href={targetUrl} rel="noopener noreferrer">
              Continue to {domain}
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
          <a
            href={targetUrl}
            rel="noopener noreferrer"
            className="text-primary-text hover:underline break-all text-center text-xs font-medium max-w-[360px]"
          >
            {targetUrl}
          </a>
        </div>

        {/* Monospace technical detail */}
        <div className="mt-[22px] w-full border-t pt-4 sm:mt-7">
          <code className="text-muted-foreground font-mono text-xs">
            @{username}@{domain} · external profile
          </code>
        </div>
      </div>
    </div>
  )
}
