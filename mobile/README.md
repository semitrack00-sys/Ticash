# TiCash Mobile (Flutter)

Phase 2 mobile client, matching the TiCash Floot mockup: dark teal theme,
balance card, quick actions (Send money / Add money / My QR), recent
activity feed and a "Send abroad" promo panel.

## Structure

- `lib/theme` — color palette, text styles and `ThemeData` (no hardcoded
  colors elsewhere in the app).
- `lib/models` — `TicashUser`, `Transaction`, `Recipient` plus realistic
  mock data used until the real API is wired up.
- `lib/providers` — Riverpod providers/notifiers for user, transactions
  and navigation state.
- `lib/widgets` — reusable UI pieces: `BalanceCard`, `QuickActionButtons`,
  `TransactionItem`, `RecentActivityList`, `SendAbroadPromo`,
  `AppNavigation` (sidebar on wide screens, bottom tabs on phones).
- `lib/screens` — `HomeScreen` plus placeholder screens for Send money,
  Wallet, Activity and Profile, wired together by
  `MainNavigationScreen`.

## Development

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
flutter run
```
