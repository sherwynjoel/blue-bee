# @blue-bee/api-client

The **shared client seam** for the Blue Bee Expo apps (driver + customer). A small, **hand-written,
fully-typed** wrapper over the proven `/v1` API — extracted from the driver app (Increment 9) in
Increment 11 so the customer app reuses the transport + session instead of reinventing it.

> Not OpenAPI-generated. The published spec lives at `/v1/docs-json`, but the contract that matters
> is the shared types in `@blue-bee/shared`; this package is a thin, typed transport over them.

## What's here

- **`ApiClient`** — `fetch` transport with an injectable `TokenStore`, single-flight
  `401 → /auth/refresh → retry`, and `problem+json → ApiError` mapping. Includes the app-agnostic
  surface: `requestOtp` / `verifyOtp` / `me` / `logout` and `registerDeviceToken` /
  `unregisterDeviceToken`. **Subclass it** to add an app's domain endpoints (the driver duty loop /
  the customer orders + tracking + media). `request` is `protected`; pass `idempotencyKey` to make a
  retried mutation replay-safe (the server's `IdempotencyInterceptor` honours `Idempotency-Key`).
- **`ApiError` / `ProblemDetails`** — typed RFC-7807 error; branch on `status` / `code` /
  `isUnauthorized` / `isConflict` (a 409 = server authority → re-sync).
- **`TokenStore` / `MemoryTokenStore`** — the keychain seam. `MemoryTokenStore` backs tests + the
  headless integration proofs. Each **app** ships its own native `SecureTokenStore`
  (expo-secure-store) implementing `TokenStore` — kept out of this package so the entry stays
  **pure** and loads under Node.
- **`useAuthSession`** — the headless auth lifecycle (status machine, hydrate-on-launch,
  OTP/login/logout-even-offline) with `onSignedIn` / `onSignOut` hooks so each app layers its own
  side effects (push registration, tracking) and domain state on top.

## Consuming it

```ts
import { ApiClient, MemoryTokenStore, useAuthSession } from '@blue-bee/api-client';

class CustomerApiClient extends ApiClient {
  listOrders(/* … */) { return this.request('GET', '/orders'); }
}
```

`build` (`tsc → dist`) must run before the apps typecheck/test (Turborepo `^build` enforces this; the
apps' jest `moduleNameMapper` points `@blue-bee/api-client` at `dist/index.js`, like `@blue-bee/shared`).
