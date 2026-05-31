'use client'

import {
  Ban,
  Bell,
  ChevronDown,
  Image as ImageIcon,
  type LucideIcon,
  Monitor,
  Settings as SettingsIcon,
  User,
  VolumeX
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
import { cn } from '@/lib/utils'

interface Props {
  children: ReactNode
}

interface SettingsTab {
  name: string
  url: string
  icon: LucideIcon
}

const tabs: SettingsTab[] = [
  { name: 'General', url: '/settings', icon: SettingsIcon },
  { name: 'Account', url: '/settings/account', icon: User },
  { name: 'Media', url: '/settings/media', icon: ImageIcon },
  { name: 'Notifications', url: '/settings/notifications', icon: Bell },
  { name: 'Blocked accounts', url: '/settings/blocks', icon: Ban },
  { name: 'Muted accounts', url: '/settings/mutes', icon: VolumeX },
  { name: 'Sessions', url: '/settings/sessions', icon: Monitor }
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
      {/* Section-level sticky header shared by every settings page, matching the
          full-width chrome the other top-level routes use. Rendered outside the
          section provider so it keeps the sticky chrome; per-page titles
          ("General", "Account Settings", …) render below in section mode. */}
      <PageHeader
        title="Settings"
        description="Manage your account and preferences"
        contentWidth="wide"
      />
      <PageHeaderSectionProvider>
        <div data-layout-width="wide" className="mx-auto w-full max-w-4xl pt-4">
          {/* Mobile and tablet: dropdown */}
          <div className="mb-4 lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    <activeTab.icon className="h-4 w-4" />
                    {activeTab.name}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                {tabs.map((tab) => (
                  <DropdownMenuItem key={tab.url} asChild>
                    <Link href={tab.url} className="flex items-center gap-2">
                      <tab.icon className="h-4 w-4" />
                      {tab.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex gap-6 lg:gap-8">
            {/* Desktop: vertical nav rail */}
            <nav
              aria-label="Settings"
              className="hidden w-52 shrink-0 lg:block"
            >
              <ul className="sticky top-4 space-y-1">
                {tabs.map((tab) => {
                  const isActive = tab.url === activeTab.url
                  return (
                    <li key={tab.url}>
                      <Link
                        href={tab.url}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <tab.icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{tab.name}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>

            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </div>
      </PageHeaderSectionProvider>
    </>
  )
}

export default Layout
