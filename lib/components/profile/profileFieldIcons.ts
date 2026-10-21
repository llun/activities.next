import {
  Activity,
  Globe,
  Image as ImageIcon,
  type LucideIcon,
  Mail,
  MapPin,
  Tag
} from 'lucide-react'

import type { ProfileFieldIconKind } from '@/lib/components/profile/profileFieldIcon'

/**
 * The lucide icon of each profile field icon kind. The profile line
 * (`ProfileFieldsBlock`) and the settings editor (`ProfileFieldsField`) both
 * draw from this one map, so a field shows the same icon in both places.
 */
export const PROFILE_FIELD_ICONS: Record<ProfileFieldIconKind, LucideIcon> = {
  location: MapPin,
  image: ImageIcon,
  activity: Activity,
  mail: Mail,
  link: Globe,
  text: Tag
}
