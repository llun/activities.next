import Image from 'next/image'
import { FC } from 'react'

// Public footer shown to logged-out visitors, matching the web-public design:
// a single bordered card with the brand line and a link to the project source.
// About/Privacy are omitted since the app has no such pages.
export const PublicFooter: FC = () => (
  <footer className="mx-auto w-full max-w-[680px] px-4 py-8">
    <div className="rounded-xl border bg-background/70 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Image
            src="/logo-nav.png"
            alt=""
            aria-hidden="true"
            width={20}
            height={20}
            className="h-5 w-5 shrink-0 object-contain"
          />
          <span>
            <strong className="font-semibold text-foreground">
              Activities
            </strong>{' '}
            — a self-hosted social + fitness server on the Fediverse.
          </span>
        </div>
        <a
          href="https://github.com/llun/activities.next"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
        >
          Source
        </a>
      </div>
    </div>
  </footer>
)
