import {
  Ban,
  Bell,
  Filter,
  Image as ImageIcon,
  PanelLeft,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserCheck,
  VolumeX
} from 'lucide-react'

import type {
  SectionNavFooter,
  SectionNavGroup
} from '@/lib/components/section-nav'
import { ProfileAvatar } from '@/lib/components/settings/ProfileAvatar'

// Everything here belongs to one actor (shown as "profile" in the UI); what is
// shared across an account's actors lives in /account, linked from the foot.
export const getSettingsGroups = (
  profile: { handle: string; username: string; iconUrl: string | null } | null
): SectionNavGroup[] => [
  {
    railOnly: true,
    items: [
      {
        name: 'Edit profile',
        url: '/settings/profile',
        icon: profile ? (
          <ProfileAvatar
            username={profile.username}
            iconUrl={profile.iconUrl}
            className="size-7 text-xs"
          />
        ) : null,
        hint: profile?.handle
      }
    ]
  },
  {
    heading: 'Preferences',
    items: [
      {
        name: 'Appearance',
        url: '/settings/appearance',
        icon: <Sun />,
        description: 'Theme on this device and how long posts show'
      },
      {
        name: 'Posting & reading',
        url: '/settings/preferences',
        icon: <SlidersHorizontal />,
        description: 'Default visibility, quotes, language, media and warnings'
      },
      {
        name: 'Notifications',
        url: '/settings/notifications',
        icon: <Bell />,
        description: 'Push and email, for each kind of event'
      },
      {
        name: 'Sidebar',
        url: '/settings/sidebar',
        icon: <PanelLeft />,
        description: 'Show, hide and reorder sidebar items'
      },
      {
        name: 'Media & AI',
        url: '/settings/media',
        icon: <ImageIcon />,
        description: 'Alt text, subject detection, AI enhance and storage'
      }
    ]
  },
  {
    heading: 'Privacy & safety',
    items: [
      {
        name: 'Privacy',
        url: '/settings/privacy',
        icon: <UserCheck />,
        description: 'Who can follow you, and where to hide places'
      },
      {
        name: 'Blocked accounts',
        url: '/settings/blocks',
        icon: <Ban />,
        description: 'Accounts that can’t follow you or see your posts'
      },
      {
        name: 'Muted accounts',
        url: '/settings/mutes',
        icon: <VolumeX />,
        description: 'Accounts hidden from your timelines'
      },
      {
        name: 'Filters',
        url: '/settings/filters',
        icon: <Filter />,
        description: 'Hide posts by word or phrase'
      }
    ]
  },
  {
    afterFooter: true,
    items: [
      {
        name: 'Delete this profile',
        url: '/settings/delete',
        icon: <Trash2 />,
        description: profile
          ? `Remove @${profile.username} and its posts from this server`
          : 'Remove this profile and its posts from this server'
      }
    ]
  }
]

export const settingsFooter: SectionNavFooter = {
  heading: 'Shared across your profiles',
  item: {
    name: 'Account & security',
    url: '/account',
    icon: <ShieldCheck />,
    description: 'Email, password, two-factor, sessions and profiles'
  }
}
