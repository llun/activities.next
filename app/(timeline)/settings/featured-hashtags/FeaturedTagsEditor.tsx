'use client'

import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { FeaturedTagsSection } from '@/lib/components/settings/profile/FeaturedTagsSection'

// The standalone Featured hashtags page. The editing itself is
// `FeaturedTagsSection`, which the Edit profile page embeds too.
export const FeaturedTagsEditor: FC = () => (
  <div className="space-y-6">
    <PageHeader
      title="Featured hashtags"
      description="Feature up to 10 hashtags on your profile so visitors can browse your posts on the topics you post about most."
    />
    <FeaturedTagsSection />
  </div>
)
