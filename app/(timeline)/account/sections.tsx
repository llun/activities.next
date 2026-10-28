import {
  ArrowDownUp,
  KeyRound,
  Mail,
  MonitorSmartphone,
  Settings,
  Users
} from 'lucide-react'

import type {
  SectionNavFooter,
  SectionNavGroup
} from '@/lib/components/section-nav'

// What an account's profiles share. Per-profile settings live in /settings,
// linked from the foot.
export const getAccountGroups = (
  info: { handle: string; profileCount: number } | null
): SectionNavGroup[] => [
  // Deliberately unheaded: on the index the identity card heads this list
  // (the page renders AccountIdentityCard above it).
  {
    items: [
      {
        name: 'Email & name',
        url: '/account/email',
        icon: <Mail />,
        description: 'Email address, account name and photo'
      },
      {
        name: 'Password & sign-in',
        url: '/account/security',
        icon: <KeyRound />,
        description: 'Password, two-factor and passkeys'
      },
      {
        name: 'Sessions & apps',
        url: '/account/sessions',
        icon: <MonitorSmartphone />,
        description: 'Where you’re signed in, and connected apps'
      },
      {
        name: 'Profiles',
        url: '/account/profiles',
        icon: <Users />,
        description: info
          ? `${info.profileCount} ${info.profileCount === 1 ? 'profile' : 'profiles'}: switch, set the default, add one`
          : 'Switch, set the default, add one'
      },
      {
        name: 'Import and export',
        url: '/account/import-export',
        icon: <ArrowDownUp />,
        description: 'Download your archive, import posts and spreadsheets'
      }
    ]
  }
]

export const getAccountFooter = (handle?: string): SectionNavFooter => ({
  heading: 'For this profile',
  hint: 'Each profile has its own',
  item: {
    name: handle ? `Settings for ${handle}` : 'Settings',
    url: '/settings',
    icon: <Settings />,
    description: 'Appearance, notifications, privacy and more'
  }
})
