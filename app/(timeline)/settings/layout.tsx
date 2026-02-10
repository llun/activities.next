'use client'

import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC, ReactNode } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'

interface Props {
  children: ReactNode
}

const Layout: FC<Props> = ({ children }) => {
  const pathname = usePathname()

  const tabs = [
    { name: 'General', url: '/settings' },
    { name: 'Account', url: '/settings/account' },
    { name: 'Media', url: '/settings/media' },
    { name: 'Notifications', url: '/settings/notifications' },
    { name: 'Fitness', url: '/settings/fitness' },
    { name: 'Sessions', url: '/settings/sessions' }
  ]

  const currentTab = tabs.find((tab) => tab.url === pathname) || tabs[0]

  return (
    <div className="space-y-6">
      {/* Mobile dropdown */}
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              {currentTab.name}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
            {tabs.map((tab) => (
              <DropdownMenuItem key={tab.url} asChild>
                <Link href={tab.url}>{tab.name}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tablet and desktop tabs */}
      <div className="hidden md:block">
        <Tabs value={pathname} className="w-full">
          <TabsList>
            {tabs.map((tab) => (
              <Link key={tab.url} href={tab.url}>
                <TabsTrigger value={tab.url}>{tab.name}</TabsTrigger>
              </Link>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {children}
    </div>
  )
}

export default Layout
