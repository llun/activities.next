import { redirect } from 'next/navigation'

// Fitness privacy moved to `/fitness/privacy`. Keep this stub so existing
// links/bookmarks to `/settings/fitness/privacy` still resolve.
export const dynamic = 'force-dynamic'

const Page = () => {
  redirect('/fitness/privacy')
}

export default Page
