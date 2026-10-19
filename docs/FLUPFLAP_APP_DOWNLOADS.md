# FlupFlap app download reporting

The admin Dashboard displays separate Android/iOS counts for today, this Monday-based
calendar week, this month and this year. History groups by day, week, month or year,
with a calendar-year selector. Store report dates are Pacific time. Counts are not
website visits, first opens, sign-ups, APK link clicks or unique people across stores.

This release uses **manual official store-report imports**, not automatic API sync.
Missing dates show an em dash; incomplete periods show `*` with the latest report/import
date. Reported zero remains zero; absent reports never become estimated zero counts.

## Deploy

Apply additive migration `20261019050000_flupflap_app_downloads` before deploying the
API, then rebuild/deploy `ticash-admin` using `scripts/render-admin-build.sh`.
No customer app rebuild or new tracking is required. Do not publish until admin UI CI passes.

## Android

Default package is `com.ticash.flupflap`; optional server override:
`FLUPFLAP_PLAY_PACKAGE_NAME`. Play Console > Download reports > Statistics > Installs:
export the complete Country-dimension CSV, including `Date`, `Package Name`, `Country`
and `Daily User Installs`. An undimensioned daily installs CSV is also supported.
Do not use device installs, cumulative installs or other dimension reports.

Admin > FlupFlap Dashboard > Import report > Android: paste the complete CSV text,
including headers and all countries. Decode UTF-16 in a text editor before copying.
Do not combine exports, filter countries, or truncate a file. Limits: 100,000
characters and the existing 128 KB JSON body limit. Oversized complete reports need
larger-file support rather than removing rows.

## iOS

Set API environment variable `FLUPFLAP_APPLE_APP_ID` to the real numeric App Store app
ID. This is not a team ID or bundle ID; no app ID, release status or download count is
assumed. Import an uncompressed DAILY Summary Sales TSV from App Store Connect.
Begin and End Date must match. Only initial iPhone/iPad/iPod units (types 1/1F/1T)
count. Updates, redownloads, IAP, Mac/TV/Vision devices and negative refund units do not.
Reports must include Device and Apple Identifier. Days absent from a matching app row
stay unavailable. Weekly/monthly sales files cannot provide daily breakdowns.

## Integrity

GET `/api/admin/flupflap/downloads?year=2026&groupBy=month` requires staff
`admin.view`, `recharge.view`, `recharge.reports`. POST `.../downloads/import` requires
`recharge.configuration.manage`. Imports atomically replace each platform/app/day,
never increment on retry. Advisory locks serialize overlapping reports. Audit records
contain actor, app, platform, hash and day count; raw reports are not retained. Other
apps are excluded. No in-memory, demo or estimated analytics are substituted on errors.

Automatic updates require a separate ingestion job and server-side Google Play
report bucket / App Store Connect reporting access. No new store access is granted
and no credentials are added to the frontend by this change.

## References

- https://support.google.com/googleplay/android-developer/answer/6135870
- https://developer.apple.com/help/app-store-connect/reference/reporting/summary-sales-report
- https://developer.apple.com/help/app-store-connect/reference/reporting/product-type-identifiers
