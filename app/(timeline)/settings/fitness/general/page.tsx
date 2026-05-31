import { redirect } from 'next/navigation'

// Fitness file management moved to `/fitness/files`. Keep this stub so existing
// links/bookmarks to `/settings/fitness/general` still resolve.
export const dynamic = 'force-dynamic'

const Page = () => {
  redirect('/fitness/files')
}

export default Page
