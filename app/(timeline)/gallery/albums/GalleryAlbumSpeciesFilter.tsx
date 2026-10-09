'use client'

import { FC, useState } from 'react'

import type { GalleryAlbumSpeciesChip } from '@/lib/services/gallery/galleryAlbumEntities'

import { getAlbumChipClassName } from './galleryAlbumsUi'

// The chips beyond these sit behind a "+N" so the grid stays near the top.
const MAX_VISIBLE_CHIPS = 5

interface Props {
  species: GalleryAlbumSpeciesChip[]
  // The count on the "All" chip.
  total: number
  // The species key being filtered to, or null for all.
  subject: string | null
  onChange: (subject: string | null) => void
}

/** The "All" chip and one chip per species, the first five before a "+N". */
export const GalleryAlbumSpeciesFilter: FC<Props> = ({
  species,
  total,
  subject,
  onChange
}) => {
  const [showAll, setShowAll] = useState(false)

  return (
    <div
      role="group"
      aria-label="Filter by species"
      className="flex min-w-0 flex-wrap gap-2"
    >
      <button
        type="button"
        aria-pressed={subject === null}
        onClick={() => onChange(null)}
        className={getAlbumChipClassName(subject === null)}
      >
        All
        <span className="tabular-nums">{total}</span>
      </button>
      {(showAll ? species : species.slice(0, MAX_VISIBLE_CHIPS)).map((chip) => (
        <button
          key={chip.key}
          type="button"
          aria-pressed={subject === chip.key}
          onClick={() => onChange(chip.key)}
          className={getAlbumChipClassName(subject === chip.key)}
        >
          <span className="max-w-40 truncate">{chip.name}</span>
          <span className="tabular-nums">{chip.count}</span>
        </button>
      ))}
      {species.length > MAX_VISIBLE_CHIPS ? (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
          className={getAlbumChipClassName(false)}
        >
          {showAll ? 'Fewer' : `+${species.length - MAX_VISIBLE_CHIPS}`}
        </button>
      ) : null}
    </div>
  )
}
