import { permanentRedirect } from 'next/navigation'

import { getAllMediaPath } from '@/app/(timeline)/gallery/media/allMediaPath'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// "Recent" became "All media". Old links, bookmarks and the subjects page's
// "See all" links keep working: the query string (`category`, `show`) is carried
// over to the new address.
const Page = async ({ searchParams }: PageProps) =>
  permanentRedirect(getAllMediaPath(await searchParams))

export default Page
