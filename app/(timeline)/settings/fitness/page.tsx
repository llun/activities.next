import { redirect } from 'next/navigation'

// Fitness moved out of Settings into the top-level `/fitness` section. Keep this
// stub so existing links/bookmarks to `/settings/fitness` still resolve.
export const dynamic = 'force-dynamic'

const Page = () => {
  redirect('/fitness/files')
}

export default Page
