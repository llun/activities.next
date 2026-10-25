import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import type { SectionNavGroup } from '@/lib/components/section-nav'

// Grouped like Settings and Account: moderation and community tools first,
// then the server's own configuration, then maintenance.
export const adminGroups = (openReports = 0): SectionNavGroup[] => [
  {
    items: [
      {
        name: 'Dashboard',
        url: '/admin/overview',
        icon: <ADMIN_ICONS.overview />,
        description: 'Instance activity and recent service statistics.'
      }
    ]
  },
  {
    heading: 'Moderation',
    items: [
      {
        name: 'Reports',
        url: '/admin/reports',
        icon: <ADMIN_ICONS.reports />,
        badge: openReports,
        badgeLabel:
          openReports === 1 ? 'unresolved report' : 'unresolved reports',
        description: 'Review and resolve reports about accounts and posts.'
      },
      {
        name: 'Accounts',
        url: '/admin/accounts',
        icon: <ADMIN_ICONS.accounts />,
        description: 'Search accounts and take local moderation actions.'
      },
      {
        name: 'Hashtags',
        url: '/admin/tags',
        icon: <ADMIN_ICONS.tags />,
        description: 'Review hashtag activity and visibility.'
      },
      {
        name: 'Server filters',
        url: '/admin/filters',
        icon: <ADMIN_ICONS.filters />,
        description: 'Set keyword rules that apply across this server.'
      },
      {
        name: 'Federation',
        url: '/admin/federation',
        icon: <ADMIN_ICONS.federation />,
        description: 'Set policies and manage remote domain blocks and allows.'
      }
    ]
  },
  {
    heading: 'Community',
    items: [
      {
        name: 'Announcements',
        url: '/admin/announcements',
        icon: <ADMIN_ICONS.announcements />,
        description: 'Publish announcements for one or all served domains.'
      },
      {
        name: 'Custom emojis',
        url: '/admin/emojis',
        icon: <ADMIN_ICONS.emojis />,
        description: 'Manage emojis available in posts and reactions.'
      }
    ]
  },
  {
    heading: 'Server',
    items: [
      {
        name: 'Server settings',
        url: '/admin/instance',
        icon: <ADMIN_ICONS.instance />,
        description: 'Configure instance identity and general behavior.'
      },
      {
        name: 'Server rules',
        url: '/admin/rules',
        icon: <ADMIN_ICONS.rules />,
        description: 'Edit the rules shown to users.'
      },
      {
        name: 'Posts & media',
        url: '/admin/posts',
        icon: <ADMIN_ICONS.posts />,
        description: 'Set server limits for posts and uploaded media.'
      },
      {
        name: 'Network',
        url: '/admin/network',
        icon: <ADMIN_ICONS.network />,
        description: 'Configure network and external-service behavior.'
      },
      {
        name: 'Served domains',
        url: '/admin/domains',
        icon: <ADMIN_ICONS.domains />,
        description: 'Add and configure the domains this server hosts.'
      },
      {
        name: 'Relays',
        url: '/admin/relays',
        icon: <ADMIN_ICONS.relays />,
        description: 'Manage relays that exchange public posts.'
      }
    ]
  },
  {
    heading: 'Maintenance',
    items: [
      {
        name: 'Queues',
        url: '/admin/queues',
        icon: <ADMIN_ICONS.queues />,
        description: 'Inspect background jobs and failed work.'
      },
      {
        name: 'System',
        url: '/admin/system',
        icon: <ADMIN_ICONS.system />,
        description: 'View version and effective configuration.'
      }
    ]
  }
]
