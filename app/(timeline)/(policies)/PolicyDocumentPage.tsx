import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns/format'
import parse from 'html-react-parser'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { renderPolicyPage } from '@/lib/utils/text/renderPolicyMarkdown'

import { PolicyContents } from './PolicyContents'

export type PolicyKind = 'terms' | 'privacy'

const POLICIES = {
  terms: { title: 'Terms of service', href: '/terms-of-service' },
  privacy: { title: 'Privacy policy', href: '/privacy-policy' }
} as const

// The document is sanitized HTML (see renderPolicyPage), parsed into
// elements rather than injected. The classes style the elements it can hold.
// Important adjacency rules beat block margins regardless of Tailwind order;
// the direct-child label exceptions have greater selector specificity.
// The compact bar's html scroll-padding already clears it, so h2s add only 16px there.
const DOCUMENT_CLASS = [
  'mt-7 max-md:mt-5 min-w-0 text-base leading-[26px] md:text-[17px] md:leading-7 [overflow-wrap:anywhere]',
  '[&>p:first-child:not(.policy-label)]:text-[17px] [&>p:first-child:not(.policy-label)]:leading-7 md:[&>p:first-child:not(.policy-label)]:text-[19px] md:[&>p:first-child:not(.policy-label)]:leading-[30px]',
  '[&_:is(h1,h2)]:mt-10 [&_:is(h1,h2)]:text-[21px] [&_:is(h1,h2)]:leading-7 [&_:is(h1,h2)]:font-semibold [&_:is(h1,h2)]:tracking-tight md:[&_:is(h1,h2)]:mt-12 md:[&_:is(h1,h2)]:text-2xl md:[&_:is(h1,h2)]:leading-8',
  '[&>p:first-child:not(.policy-label)]:mt-0! [&>:is(h1,h2,h3,h4,h5,h6):first-child]:mt-0! [&_h2]:scroll-mt-20 max-md:[html:has([data-mobile-compact-header])_&_h2]:scroll-mt-4',
  '[&_h3]:mt-7 [&_h3]:text-lg [&_h3]:leading-7 [&_h3]:font-semibold',
  '[&_h4]:mt-6 [&_h4]:font-semibold [&_h5]:mt-6 [&_h5]:font-semibold [&_h6]:mt-6 [&_h6]:font-semibold',
  '[&_:is(h1,h2,h3,h4,h5,h6)+*]:mt-3!',
  '[&_p]:mt-4 [&_ul]:mt-2 [&_ol]:mt-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-[22px] [&_ol]:pl-[22px]',
  '[&_li]:mt-2.5 [&_li:first-child]:mt-0! [&_li]:marker:text-muted-foreground [&_li>p:first-child]:mt-0',
  '[&>p.policy-label]:mt-7 [&>p.policy-label:first-child]:mt-0! [&>p.policy-label]:font-semibold [&>p.policy-label>strong]:font-semibold [&>h2+p.policy-label]:mt-4! [&>p.policy-label+ul]:mt-1.5! [&>p.policy-label+ol]:mt-1.5!',
  '[&_a]:text-(color:--link-color) [&_a:hover]:text-(color:--link-color-hover) [&_a]:underline [&_a:hover]:no-underline',
  '[&_blockquote]:mt-4 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
  '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm',
  '[&_pre]:bg-muted [&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_hr]:my-8 [&_hr]:border-t',
  '[&_table]:mt-4 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:text-sm [&_table]:[overflow-wrap:normal] [&_th]:border [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:px-3 [&_td]:py-1.5'
].join(' ')

const footerLinkClass =
  'text-muted-foreground hover:text-foreground underline underline-offset-2'

interface PolicyDocumentPageProps {
  kind: PolicyKind
}

/**
 * The visited domain's terms of service or privacy policy as a public page:
 * the title, when it last changed (UTC, omitted when the document has no date),
 * the rendered Markdown and a footer linking the other document, the contact
 * email and the project. Not found when the domain has no such document.
 */
export const PolicyDocumentPage: FC<PolicyDocumentPageProps> = async ({
  kind
}) => {
  const identity = await getVisitedDomainIdentity()
  const policy =
    kind === 'terms' ? identity.termsOfService : identity.privacyPolicy
  if (!policy) notFound()

  const { title } = POLICIES[kind]
  const other = kind === 'terms' ? 'privacy' : 'terms'
  const otherPolicy =
    other === 'terms' ? identity.termsOfService : identity.privacyPolicy
  const { html, headings } = renderPolicyPage(policy.markdown, {
    domain: identity.domain,
    title
  })
  // Formatted here in UTC and passed as text: the server cannot know the
  // reader's zone, and this page has no client part to adjust it.
  const updatedAt =
    policy.updatedAt === null ? null : new UTCDate(policy.updatedAt)

  return (
    <>
      {/* Signed-in phones need the menu button; renders nothing without the
          navigation provider, so logged-out pages are unchanged. It is the h1
          below md (the layout hides the article's h1 there), like PageHeader. */}
      <MobileCompactHeader title={title} as="h1" />
      <article className="w-full min-w-0 max-w-[560px]">
        <h1 className="text-[28px] leading-9 font-bold tracking-tight md:text-4xl md:leading-[44px]">
          {title}
        </h1>
        {updatedAt ? (
          <p className="text-muted-foreground mt-1.5 text-sm md:mt-2">
            Last updated{' '}
            <time dateTime={updatedAt.toISOString()}>
              {format(updatedAt, 'd MMMM yyyy')}
            </time>
          </p>
        ) : null}
        <PolicyContents headings={headings} />
        <div className={DOCUMENT_CLASS}>{parse(html)}</div>
        <footer className="text-muted-foreground mt-12 flex flex-col gap-1.5 border-t pt-5 text-sm md:flex-row md:flex-wrap md:justify-center md:gap-x-5">
          {otherPolicy ? (
            <>
              <Link href={POLICIES[other].href} className={footerLinkClass}>
                {POLICIES[other].title}
              </Link>
              <span aria-hidden="true" className="max-md:hidden">
                &middot;
              </span>
            </>
          ) : null}
          {identity.contactEmail ? (
            <>
              <span>
                Contact{' '}
                <a
                  href={`mailto:${identity.contactEmail}`}
                  className={footerLinkClass}
                >
                  {identity.contactEmail}
                </a>
              </span>
              <span aria-hidden="true" className="max-md:hidden">
                &middot;
              </span>
            </>
          ) : null}
          <span>
            Powered by{' '}
            <a
              href="https://github.com/llun/activities.next"
              target="_blank"
              rel="noopener noreferrer"
              className={footerLinkClass}
            >
              Activities.next
            </a>
          </span>
        </footer>
      </article>
    </>
  )
}
