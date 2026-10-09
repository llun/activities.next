'use client'

import { Clock, ExternalLink, Images, MapPin, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { BackLink } from '@/lib/components/back-link'
import { GalleryPagedGrid } from '@/lib/components/gallery/GalleryPagedGrid'
import {
  GALLERY_CATEGORY_ICONS,
  GALLERY_CATEGORY_SINGULAR,
  formatGalleryDate
} from '@/lib/components/gallery/galleryCategories'
import {
  formatTaxonPath,
  getGbifSpeciesHref,
  getHashtagHref,
  toScientificHashtag
} from '@/lib/components/gallery/galleryTaxonomy'
import { PageHeader } from '@/lib/components/page-header'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
import type {
  GalleryMediaPage,
  GallerySubjectEntry
} from '@/lib/services/gallery/galleryEntities'

interface Props {
  actorId: string
  // `count` is null when the subject is missing from the capped index.
  subject: Omit<GallerySubjectEntry, 'cover' | 'count'> & {
    count: number | null
  }
  initialPage: GalleryMediaPage
  /**
   * The hashtag a post gets from the common name (`CommonKingfisher`), worked
   * out on the server where the hashtag rules live. The scientific-name tag is
   * worked out here.
   */
  commonTag?: string | null
  /**
   * "Where": the subject's country names ("Costa Rica, Panama +2"), worked
   * out on the server. `Intl.DisplayNames` names some regions differently
   * across ICU versions (Türkiye or Turkey), so naming them here would let the
   * browser's text disagree with the server HTML it hydrates.
   */
  where?: string | null
}

export const GallerySubjectDetailView: FC<Props> = ({
  actorId,
  subject,
  initialPage,
  commonTag = null,
  where = null
}) => {
  const name = subject.name ?? subject.scientificName ?? 'Unnamed subject'
  const taxonPath = formatTaxonPath(subject.taxonPath)
  const gbifHref = getGbifSpeciesHref(subject.taxonKey)
  const scientificTag = toScientificHashtag(subject.scientificName)
  const browseTag = scientificTag ?? commonTag
  const tagLabel = [scientificTag, commonTag]
    .filter(
      (tag, index, all): tag is string => !!tag && all.indexOf(tag) === index
    )
    .map((tag) => `#${tag}`)
  const CategoryIcon = subject.category
    ? GALLERY_CATEGORY_ICONS[subject.category]
    : null

  return (
    <div className="space-y-6">
      <BackLink href="/gallery" accessibleName="Back to subjects" />
      <PageHeader
        title={name}
        description={
          subject.name && subject.scientificName ? (
            <span className="italic">{subject.scientificName}</span>
          ) : undefined
        }
      />

      {subject.category ? (
        <p className="text-muted-foreground -mt-4 flex items-center gap-1.5 text-sm font-medium">
          {CategoryIcon ? (
            <CategoryIcon className="size-4" aria-hidden="true" />
          ) : null}
          {GALLERY_CATEGORY_SINGULAR[subject.category]}
        </p>
      ) : null}

      {taxonPath || gbifHref || scientificTag ? (
        <div className="text-muted-foreground -mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {taxonPath ? <span>{taxonPath}</span> : null}
          {scientificTag ? (
            <Link
              href={getHashtagHref(scientificTag)}
              prefetch={false}
              className="text-primary-text font-medium hover:underline"
            >
              Follow #{scientificTag}
            </Link>
          ) : null}
          {gbifHref ? (
            <a
              href={gbifHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-text inline-flex items-center gap-1 font-medium hover:underline"
            >
              GBIF
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      ) : null}

      <StatStrip variant="summary" columns={where ? 4 : 3}>
        <StatCell
          label="First seen"
          icon={Sparkles}
          value={formatGalleryDate(subject.firstSeenAt) || null}
        />
        <StatCell
          label="Last seen"
          icon={Clock}
          value={formatGalleryDate(subject.lastSeenAt) || null}
        />
        <StatCell
          label="Photos"
          icon={Images}
          value={subject.count?.toLocaleString('en-US') ?? null}
        />
        {where ? <StatCell label="Where" icon={MapPin} value={where} /> : null}
      </StatStrip>

      <GalleryPagedGrid
        actorId={actorId}
        subject={subject.key}
        initialPage={initialPage}
        albumsOwnerId={actorId}
      />

      {browseTag ? (
        <section
          aria-labelledby="subject-fediverse-heading"
          className="space-y-2 rounded-lg border bg-background p-4"
        >
          <h2 id="subject-fediverse-heading" className="font-semibold">
            {/* No plural is built from a name: "Finchs", "Foxs" and
                "Basss" all read wrong, and a scientific name never takes one. */}
            {subject.name ? (
              <>More posts about {subject.name} on the fediverse</>
            ) : subject.scientificName ? (
              <>
                More posts about{' '}
                <span className="italic">{subject.scientificName}</span> on the
                fediverse
              </>
            ) : (
              <>More posts on the fediverse</>
            )}
          </h2>
          <p className="text-muted-foreground text-sm">
            Posts tagged {tagLabel.join(' or ')}.
          </p>
          <Link
            href={getHashtagHref(browseTag)}
            prefetch={false}
            className="text-primary-text inline-block text-sm font-medium hover:underline"
          >
            Browse posts
          </Link>
        </section>
      ) : null}
    </div>
  )
}
