'use client'

import {
  Activity,
  ChevronDown,
  Files,
  Globe,
  Lock,
  type LucideIcon
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC, ReactNode } from 'react'

import {
  PageHeader,
  PageHeaderSectionProvider
} from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'

interface Props {
  children: ReactNode
}

interface FitnessTab {
  name: string
  url: string
  icon: LucideIcon
}

const tabs: FitnessTab[] = [
  { name: 'Overview', url: '/fitness', icon: Activity },
  { name: 'Files', url: '/fitness/files', icon: Files },
  { name: 'Privacy', url: '/fitness/privacy', icon: Lock },
  { name: 'Strava', url: '/fitness/strava', icon: Globe }
]

const Layout: FC<Props> = ({ children }) => {
  const pathname = usePathname()

  const activeTab =
    tabs
      .filter(
        (tab) => pathname === tab.url || pathname.startsWith(`${tab.url}/`)
      )
      .sort((a, b) => b.url.length - a.url.length)[0] || tabs[0]

  return (
    <>
      {/* Shared section header — sticky chrome, outside the section provider, so
          the fitness section reads like Settings and the other top-level routes.
          Per-page titles ("Overview", "Files", …) render below in section mode. */}
      <PageHeader
        title="Fitness"
        description="Your training activity and settings"
        contentWidth="wide"
      />
      <PageHeaderSectionProvider>
        <div data-layout-width="wide" className="mx-auto w-full max-w-4xl pt-4">
          {/* Dropdown sub-navigation on every breakpoint (desktop included) so
              the content always gets the full width — no vertical rail. */}
          <nav aria-label="Fitness" className="mb-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between sm:w-64"
                >
                  <span className="flex items-center gap-2">
                    <activeTab.icon className="h-4 w-4 text-primary" />
                    {activeTab.name}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                {tabs.map((tab) => (
                  <DropdownMenuItem key={tab.url} asChild>
                    <Link
                      href={tab.url}
                      aria-current={
                        tab.url === activeTab.url ? 'page' : undefined
                      }
                      className="flex items-center gap-2"
                    >
                      <tab.icon className="h-4 w-4" />
                      {tab.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          <div className="min-w-0">{children}</div>
        </div>
      </PageHeaderSectionProvider>
    </>
  )
}

export default Layout
