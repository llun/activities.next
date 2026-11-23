import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

// shortcut: draws the unlinked Bluesky account (2 rows); a linked one has 4 or
// 5, which the skeleton cannot know. Read the link state here if it jumps.
const Loading = () => <SectionSkeleton sections={[2, 3]} form />

export default Loading
