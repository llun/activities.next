import { permanentRedirect } from 'next/navigation'

// The timeline layout reads the config and database, so this is never
// prerendered.
export const dynamic = 'force-dynamic'

// Navigation was renamed to Sidebar. Keep this stub so existing links and
// bookmarks to `/settings/navigation` still resolve.
const Page = () => {
  permanentRedirect('/settings/sidebar')
}

export default Page
