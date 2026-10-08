import {
  Bird,
  Bug,
  Droplet,
  Fish,
  Leaf,
  type LucideIcon,
  Mountain,
  Rabbit,
  Shapes,
  Sprout,
  Turtle
} from 'lucide-react'

import type { GallerySubjectGroupCategory } from '@/lib/services/gallery/galleryEntities'
import type { MediaSubjectCategory } from '@/lib/types/database/gallery'

export const GALLERY_CATEGORY_LABELS: Record<
  GallerySubjectGroupCategory,
  string
> = {
  bird: 'Birds',
  mammal: 'Mammals',
  reptile: 'Reptiles',
  amphibian: 'Amphibians',
  fish: 'Fish',
  insect: 'Insects',
  plant: 'Plants',
  fungus: 'Fungi',
  landscape: 'Landscapes',
  other: 'Other',
  unidentified: 'Other subjects'
}

// Singular, for the life list's "Group" wording.
export const GALLERY_CATEGORY_SINGULAR: Record<MediaSubjectCategory, string> = {
  bird: 'Bird',
  mammal: 'Mammal',
  reptile: 'Reptile',
  amphibian: 'Amphibian',
  fish: 'Fish',
  insect: 'Insect',
  plant: 'Plant',
  fungus: 'Fungus',
  landscape: 'Landscape',
  other: 'Other'
}

export const GALLERY_CATEGORY_ICONS: Record<
  GallerySubjectGroupCategory,
  LucideIcon
> = {
  bird: Bird,
  mammal: Rabbit,
  reptile: Turtle,
  amphibian: Droplet,
  fish: Fish,
  insect: Bug,
  plant: Leaf,
  fungus: Sprout,
  landscape: Mountain,
  other: Shapes,
  unidentified: Shapes
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
})

/**
 * "14 Mar 2025" style date for an ISO timestamp. Formatted in UTC with a fixed
 * locale so the server render and the hydrating client agree.
 */
export const formatGalleryDate = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = DATE_FORMAT.formatToParts(date)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${get('day')} ${get('month')} ${get('year')}`
}

export const pluralize = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
