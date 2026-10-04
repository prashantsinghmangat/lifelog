/**
 * The product's public identity, in one place, because the name is not final.
 *
 * Everything a rebrand changes is here. Everything a rebrand must **not**
 * change is deliberately not here, and that split is the whole point of the
 * file: a new name has to cost a config edit, some assets and the store
 * listing — never a data migration.
 *
 * Public identity (this file):
 *   the displayed name, the short name, the tagline, the description, the
 *   site and issues URLs, and the slug that names a downloaded file.
 *
 * Technical identity (**not** here, and not to be renamed with the brand):
 *   `appId` `com.prashant.lifelog` and the Java package under it — changing
 *     either is a new app on the Play Store, not a rename.
 *   `lifelog.theme` / `.palette` / `.who` / `.lock` / `.nudges` /
 *     `.log.<userId>` — localStorage keys. A rename orphans a device's
 *     settings, its guest log and its lock state.
 *   `lifelog-attachments` — the IndexedDB database. A rename orphans every
 *     photo and document already on the device.
 *   `lifelog-reminders-v2` / `lifelog-prompts-v1` — notification channels. A
 *     channel's settings belong to the user once it exists, so a renamed
 *     channel is a new one at default importance and every reminder on it
 *     arrives silently. That bug has already happened here once; see
 *     ARCHITECTURE.md under "Sound comes from the channel".
 *   `UID:<id>@lifelog` in `ics.ts` — the identity of every event already
 *     exported to somebody's calendar.
 *   `LIFELOG_KEYSTORE` and the other signing env vars in
 *     `android/app/build.gradle`.
 *
 * Two files carry the name where TypeScript cannot reach them —
 * `android/app/src/main/res/values/strings.xml` and `public/privacy.html` —
 * so `product.test.ts` fails when they drift from this table rather than a
 * generator writing them. The same bargain `palettes.ts` strikes with
 * `index.css`, for the same reason: two copies that must agree are kept in
 * agreement by a test, not by remembering.
 *
 * `as const` and nothing more. There is no `Object.freeze`: the type is the
 * guarantee, no code mutates this, and the call would cost bytes the 150 KB
 * page budget would rather spend elsewhere.
 */
export const PRODUCT = {
  /** The name as written on screen. Lowercase is the current styling. */
  name: 'lifelog',
  /** Where a launcher or a tab strip will truncate anyway. */
  shortName: 'lifelog',
  /** Filename-safe. Names a downloaded export, not a URL or a storage key. */
  slug: 'lifelog',
  /** The one-line promise. The PWA manifest's description. */
  tagline: 'One timeline for expenses, hours, events and notes',
  /**
   * The longer sentence, for a store listing or a social preview. Nothing
   * consumes it yet — the app has no `og:` metadata and no marketing page —
   * and it is here so that when one of those arrives the name is already
   * configured rather than typed in again.
   */
  description:
    'A personal life timeline. Expenses, work hours, events and notes are the same thing — something that happened, or will happen, on a date.',
  /** Where the app is served. */
  url: 'https://lifelog-timeline.netlify.app',
  /** The only support route the privacy page can honestly offer today. */
  issuesUrl: 'https://github.com/prashantsinghmangat/lifelog/issues',
} as const
