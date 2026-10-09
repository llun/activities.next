import { Download, Layers, ShieldBan, ShieldCheck, Trash2 } from 'lucide-react'
import { redirect } from 'next/navigation'

import {
  createDomainAllowAction,
  createDomainBlockAction,
  deleteDomainAllowAction,
  deleteDomainBlockAction,
  importKnownDomainBlocklistAction
} from '@/app/(timeline)/admin/federation/actions'
import { Pagination } from '@/lib/components/admin/Pagination'
import { FederationPolicyForm } from '@/lib/components/admin/settings/FederationPolicyForm'
import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FormRow, formRowHintId } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import { Input } from '@/lib/components/ui/input'
import { Select } from '@/lib/components/ui/select'
import { Textarea } from '@/lib/components/ui/textarea'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { KNOWN_DOMAIN_BLOCKLIST_SOURCES } from '@/lib/services/federation/blocklistSources'
import { getServerSettingsView } from '@/lib/services/serverSettings'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

const STATUS_MESSAGES: Record<string, string> = {
  'block-saved': 'Domain block saved',
  'block-deleted': 'Domain block deleted',
  'allow-saved': 'Domain allow saved',
  'allow-deleted': 'Domain allow deleted',
  'invalid-block-domain': 'Enter a valid domain to block',
  'invalid-allow-domain': 'Enter a valid domain to allow',
  'invalid-source': 'Choose a known blocklist source',
  'import-failed': 'Unable to import the blocklist'
}

const ERROR_STATUSES = new Set([
  'invalid-block-domain',
  'invalid-allow-domain',
  'invalid-source',
  'import-failed'
])

const ADMIN_FEDERATION_PAGE_SIZE = 100

const getStatusMessage = (status?: string): string | null => {
  if (!status) return null
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status]

  const match = /^imported-(\d+)-(\d+)-(\d+)$/.exec(status)
  if (!match) return null

  return `Imported ${match[1]} new block${match[1] === '1' ? '' : 's'}, updated ${match[2]}, skipped ${match[3]}`
}

const getOffset = (value?: string): number => {
  const offset = Number(value ?? 0)
  return Number.isInteger(offset) && offset > 0 ? offset : 0
}

const getPaginationHref = ({
  blockOffset,
  allowOffset
}: {
  blockOffset: number
  allowOffset: number
}): string => {
  const params = new URLSearchParams()
  if (blockOffset > 0) params.set('blockOffset', String(blockOffset))
  if (allowOffset > 0) params.set('allowOffset', String(allowOffset))

  const query = params.toString()
  return query ? `/admin/federation?${query}` : '/admin/federation'
}

const getNextOffset = (offset: number, count: number): number => offset + count

const getPreviousOffset = (offset: number): number =>
  Math.max(0, offset - ADMIN_FEDERATION_PAGE_SIZE)

const getPaginationLabel = (
  noun: string,
  offset: number,
  count: number,
  total: number
): string => {
  if (count === 0) return `Showing 0 of ${total} ${noun}`
  return `Showing ${offset + 1}-${offset + count} of ${total} ${noun}`
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const params = await searchParams
  const { status } = params
  const blockOffset = getOffset(params.blockOffset)
  const allowOffset = getOffset(params.allowOffset)

  const [blocks, allows, stats] = await Promise.all([
    database.getDomainBlocks({
      limit: ADMIN_FEDERATION_PAGE_SIZE,
      offset: blockOffset
    }),
    database.getDomainAllows({
      limit: ADMIN_FEDERATION_PAGE_SIZE,
      offset: allowOffset
    }),
    database.getDomainFederationRuleStats()
  ])
  const statusMessage = getStatusMessage(status)
  const isErrorStatus = status ? ERROR_STATUSES.has(status) : false
  const sourceCounts = new Map(Object.entries(stats.sourceCounts))
  const config = getConfig()
  const { settings, locks } = await getServerSettingsView(database)
  const federationMode = settings.federation.mode
  // Trusted media domains stay env-configured (they feed the Edge-runtime CSP),
  // so they are shown read-only in the policy form.
  const mediaDomains = config.allowMediaDomains ?? []
  const hasPreviousBlocks = blockOffset > 0
  const hasNextBlocks =
    blocks.length > 0 &&
    getNextOffset(blockOffset, blocks.length) < stats.blocks
  const hasPreviousAllows = allowOffset > 0
  const hasNextAllows =
    allows.length > 0 &&
    getNextOffset(allowOffset, allows.length) < stats.allows

  return (
    <div className="space-y-6">
      <PageHeader
        title="Federation"
        description={
          federationMode === 'allowlist'
            ? 'Limited federation mode.'
            : 'Open federation mode.'
        }
      />

      {statusMessage && (
        <Alert
          tone={isErrorStatus ? 'error' : 'success'}
          title={statusMessage}
        />
      )}

      <StatStrip columns={3}>
        <StatCell
          label="Blocked domains"
          icon={ShieldBan}
          value={stats.blocks.toLocaleString()}
        />
        <StatCell
          label="Allowed domains"
          icon={ShieldCheck}
          value={stats.allows.toLocaleString()}
        />
        <StatCell
          label="Shared-list entries"
          icon={Layers}
          value={stats.sourceBlocks.toLocaleString()}
        />
      </StatStrip>

      <FederationPolicyForm
        settings={settings}
        locks={locks}
        mediaDomains={mediaDomains}
      />

      <Section
        title="Known blocklist"
        description="Import a Mastodon-compatible CSV source."
      >
        <FramedList aria-label="Known blocklist sources">
          {KNOWN_DOMAIN_BLOCKLIST_SOURCES.map((source) => (
            <FramedListItem key={source.id}>
              <form
                action={importKnownDomainBlocklistAction}
                className="flex items-center justify-between gap-3"
              >
                <input type="hidden" name="source" value={source.id} />
                <div>
                  <p className="font-medium">{source.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {sourceCounts.get(source.id) ?? 0} imported entries
                  </p>
                </div>
                <Button type="submit" variant="outline" className="sm:w-auto">
                  <Download />
                  Import
                </Button>
              </form>
            </FramedListItem>
          ))}
        </FramedList>
      </Section>

      <Section title="Add domain block">
        <form action={createDomainBlockAction}>
          <Frame
            divided
            footer={
              <div className="flex justify-end">
                <Button type="submit">Save block</Button>
              </div>
            }
          >
            <FormRow label="Domain" htmlFor="block-domain">
              <Input
                id="block-domain"
                required
                name="domain"
                placeholder="example.social"
              />
            </FormRow>
            <FormRow
              label="Severity"
              htmlFor="block-severity"
              hint="Only Suspend rejects federation. Silence and Noop are stored for Mastodon-compatible metadata."
            >
              <Select
                id="block-severity"
                name="severity"
                defaultValue="suspend"
                aria-describedby={formRowHintId('block-severity')}
              >
                <option value="suspend">Suspend</option>
                <option value="silence">Silence</option>
                <option value="noop">Noop</option>
              </Select>
            </FormRow>
            <FormRow label="Public comment" htmlFor="block-public-comment" wide>
              <Textarea
                id="block-public-comment"
                name="publicComment"
                rows={2}
              />
            </FormRow>
            <FormRow
              label="Private comment"
              htmlFor="block-private-comment"
              wide
            >
              <Textarea
                id="block-private-comment"
                name="privateComment"
                rows={2}
              />
            </FormRow>
            <FormRow label="Reject media" htmlFor="block-reject-media" inline>
              <Checkbox id="block-reject-media" name="rejectMedia" />
            </FormRow>
            <FormRow
              label="Reject reports"
              htmlFor="block-reject-reports"
              inline
            >
              <Checkbox id="block-reject-reports" name="rejectReports" />
            </FormRow>
            <FormRow label="Obfuscate" htmlFor="block-obfuscate" inline>
              <Checkbox id="block-obfuscate" name="obfuscate" />
            </FormRow>
          </Frame>
        </form>
      </Section>

      <Section title="Add domain allow">
        <form action={createDomainAllowAction}>
          <Frame
            divided
            footer={
              <div className="flex justify-end">
                <Button type="submit">Save allow</Button>
              </div>
            }
          >
            <FormRow label="Domain" htmlFor="allow-domain">
              <Input
                id="allow-domain"
                required
                name="domain"
                placeholder="trusted.social"
              />
            </FormRow>
          </Frame>
        </form>
      </Section>

      <Section title="Domain blocks" meta={stats.blocks.toLocaleString()}>
        <div className="space-y-3">
          {blocks.length === 0 ? (
            <EmptyState icon={ShieldBan} title="No domains blocked">
              Blocked domains are listed here once you add one.
            </EmptyState>
          ) : (
            <FramedList aria-label="Domain blocks">
              {blocks.map((block) => (
                <FramedListItem
                  key={block.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{block.domain}</p>
                    <p className="text-muted-foreground text-sm">
                      {block.severity}
                      {block.publicComment ? ` - ${block.publicComment}` : ''}
                    </p>
                  </div>
                  <form action={deleteDomainBlockAction}>
                    <input type="hidden" name="id" value={block.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete block for ${block.domain}`}
                    >
                      <Trash2 />
                    </Button>
                  </form>
                </FramedListItem>
              ))}
            </FramedList>
          )}
          <Pagination
            navLabel="Domain blocks pagination"
            label={getPaginationLabel(
              'blocked domains',
              blockOffset,
              blocks.length,
              stats.blocks
            )}
            previousHref={
              hasPreviousBlocks
                ? getPaginationHref({
                    blockOffset: getPreviousOffset(blockOffset),
                    allowOffset
                  })
                : undefined
            }
            nextHref={
              hasNextBlocks
                ? getPaginationHref({
                    blockOffset: getNextOffset(blockOffset, blocks.length),
                    allowOffset
                  })
                : undefined
            }
          />
        </div>
      </Section>

      <Section title="Domain allows" meta={stats.allows.toLocaleString()}>
        <div className="space-y-3">
          {allows.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No domains allowed">
              Allowed domains are listed here once you add one.
            </EmptyState>
          ) : (
            <FramedList aria-label="Domain allows">
              {allows.map((allow) => (
                <FramedListItem
                  key={allow.id}
                  className="flex items-center justify-between gap-3"
                >
                  <p className="min-w-0 truncate font-medium">{allow.domain}</p>
                  <form action={deleteDomainAllowAction}>
                    <input type="hidden" name="id" value={allow.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete allow for ${allow.domain}`}
                    >
                      <Trash2 />
                    </Button>
                  </form>
                </FramedListItem>
              ))}
            </FramedList>
          )}
          <Pagination
            navLabel="Domain allows pagination"
            label={getPaginationLabel(
              'allowed domains',
              allowOffset,
              allows.length,
              stats.allows
            )}
            previousHref={
              hasPreviousAllows
                ? getPaginationHref({
                    blockOffset,
                    allowOffset: getPreviousOffset(allowOffset)
                  })
                : undefined
            }
            nextHref={
              hasNextAllows
                ? getPaginationHref({
                    blockOffset,
                    allowOffset: getNextOffset(allowOffset, allows.length)
                  })
                : undefined
            }
          />
        </div>
      </Section>
    </div>
  )
}

export default Page
