import { permanentRedirect } from 'next/navigation'

// Navigation was renamed to Sidebar. Keep this stub so existing links and
// bookmarks to `/settings/navigation` still resolve.
const Page = () => {
  permanentRedirect('/settings/sidebar')
}

export default Page
