import { Mastodon } from '@/lib/types/activitypub'
import { ActorSettings } from '@/lib/types/database/rows'

// The single construction point for the Mastodon 4.6 Profile entity
// (https://docs.joinmastodon.org/entities/Profile/), built from the public
// Account plus the actor's stored settings. Differences from
// Account/CredentialAccount:
// - display_name/note/fields carry the RAW stored values — the same values
//   verify_credentials exposes under `source` — never rendered HTML
// - avatar/header are null when unset (Account serializes them as '')
// hide_collections is nullable and indexable defaults to false when the actor
// has no stored preference; both flow from the actor settings that
// update_credentials / PATCH profile persist.
export const buildProfile = ({
  account,
  settings
}: {
  account: Mastodon.Account
  settings: ActorSettings | undefined
}): Mastodon.Profile =>
  Mastodon.Profile.parse({
    id: account.id,
    display_name: account.display_name,
    note: account.source.note,
    fields: account.source.fields,
    avatar: settings?.iconUrl ?? null,
    avatar_static: settings?.iconUrl ?? null,
    avatar_description: settings?.avatarDescription ?? '',
    header: settings?.headerImageUrl ?? null,
    header_static: settings?.headerImageUrl ?? null,
    header_description: settings?.headerDescription ?? '',
    locked: account.locked,
    bot: account.bot,
    hide_collections: settings?.hideCollections ?? null,
    discoverable: account.discoverable,
    indexable: settings?.indexable ?? false,
    show_media: settings?.showMedia ?? true,
    show_media_replies: settings?.showMediaReplies ?? true,
    show_featured: settings?.showFeatured ?? true,
    attribution_domains: settings?.attributionDomains ?? []
  })
