import { redirect } from 'next/navigation'

// Strava integration moved to `/fitness/strava`. Keep this stub so existing
// links/bookmarks to `/settings/fitness/strava` still resolve.
export const dynamic = 'force-dynamic'

const Page = () => {
  redirect('/fitness/strava')
}

export default Page
