import { redirect } from 'next/navigation'

// The fitness heatmap moved to the top-level `/fitness/heatmap`. Keep this stub
// so existing links/bookmarks to `/:actor/fitness/heatmap` still resolve.
export const dynamic = 'force-dynamic'

const Page = () => {
  redirect('/fitness/heatmap')
}

export default Page
