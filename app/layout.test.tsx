import { renderToStaticMarkup } from 'react-dom/server'

import RootLayout from './layout'

vi.mock('@/lib/components/navigation-history/InAppHistoryTracker', () => ({
  InAppHistoryTracker: () => <span data-testid="in-app-history-tracker" />
}))

vi.mock('@/lib/components/theme', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children
}))

describe('RootLayout', () => {
  // The post page's history Back reads what the tracker records, so it has to
  // be mounted above every route group. Without it, every Back falls back to
  // "Back to profile" and nothing else fails.
  it('mounts the in-app history tracker around every page', () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main data-testid="page" />
      </RootLayout>
    )

    const body = markup.slice(markup.indexOf('<body'))
    expect(body).toContain('data-testid="in-app-history-tracker"')
    expect(body).toContain('data-testid="page"')
  })
})
