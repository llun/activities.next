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
          {/* Dropdown sub-navigation on every breakpoint (desktop included) so
              the content always gets the full width — no vertical rail. */}
          <nav aria-label="Settings" className="mb-4">
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
              <DropdownMenuContent
                align="start"
                className="w-[--radix-dropdown-menu-trigger-width]"
              >
                {tabs.map((tab) => {
                  const isActive = tab.url === activeTab.url
                  return (
                    <DropdownMenuItem key={tab.url} asChild>
                      <Link
                        href={tab.url}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2',
                          isActive && 'font-medium text-primary'
                        )}
                      >
                        <tab.icon className="h-4 w-4" />
                        {tab.name}
                      </Link>
                    </DropdownMenuItem>
                  )
                })}
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
