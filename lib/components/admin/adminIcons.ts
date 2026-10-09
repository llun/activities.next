import {
  BarChart,
  FileText,
  Filter,
  Flag,
  Globe,
  Hash,
  Link as LinkIcon,
  ListChecks,
  type LucideIcon,
  Megaphone,
  Radio,
  ScrollText,
  Server,
  Settings,
  Smile,
  Users
} from 'lucide-react'

/**
 * One icon per Admin page, shared by the section navigation and by each page's
 * `EmptyState`, so a page's empty state wears the icon the menu gave it.
 */
export const ADMIN_ICONS = {
  overview: BarChart,
  accounts: Users,
  reports: Flag,
  rules: ScrollText,
  tags: Hash,
  announcements: Megaphone,
  filters: Filter,
  emojis: Smile,
  federation: Globe,
  relays: Radio,
  posts: FileText,
  network: LinkIcon,
  instance: Settings,
  queues: ListChecks,
  system: Server
} satisfies Record<string, LucideIcon>
