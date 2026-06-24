# apps/driver — Driver app (React Native + Expo, offline-first)

The field app **and the GPS/scan source that powers all tracking.** PRD §4.4, §7D, §6.2, §8.6.

**MVP:** my route today (optimized stops + map, hand-off to native nav) · pickup (scan/tally carts/items vs expected) · delivery (validate vs load sheet, scan, **POD = geo-tagged photo + signature**) · background location on a duty cycle (consent + visible "sharing on" indicator) · comms/exceptions (skip, failed, ad-hoc) · optional take-payment.

**Offline-first:** local store (WatermelonDB/SQLite or Realm) + mutation queue; **custody/scan events append-only**; **stop status authoritative over raw GPS**.

**Stack:** Expo + RN + TS · expo-location + expo-task-manager (background GPS) · camera/barcode scanner · signature capture.

**Watch-out:** background geolocation reliability varies across iOS/Android versions — budget real device-matrix testing and degrade gracefully (PRD §15).
