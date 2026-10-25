import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => (
  <SectionSkeleton
    sections={[4, 2, 2, 3]}
    // The terms box holds two 16-row Markdown textareas.
    tallSections={[1]}
    form
    label="Loading server settings"
  />
)

export default Loading
