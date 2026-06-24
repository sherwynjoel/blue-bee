# apps/customer — Customer app (React Native + Expo)

Residential specialty customers **and** B2B account staff — two modes behind one login. PRD §4.1, §7A.

**MVP:** sign up / log in (phone OTP, Apple/Google) · book a specialty job, add items + photos · receive & approve quote · **"track my truck"** (live map + ETA + timeline) · before/after photos · pay (Stripe / Apple Pay / Google Pay) · chat · rate.

**Stack:** Expo + RN + TS · react-native-maps (Google) · Socket.IO client · Stripe RN SDK · Expo Notifications.

**First:** `npx create-expo-app@latest . -t expo-template-blank-typescript`, then wire `packages/shared` + `packages/api-client`.
