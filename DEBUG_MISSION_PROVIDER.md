# Diagnosis: `useMission must be used within MissionProvider` Runtime Error

## 1. Project Router Architecture
- **Router Type**: Next.js 13.5.1 **App Router** (`app/` directory).
- **Pages Router**: None (`pages/` directory does not exist).
- **Routing Structure**: Pure App Router with layout nesting in `app/layout.tsx` and sub-routes under `app/ai-planner/*`, `app/dashboard`, `app/demo`, `app/booking`, `app/processing`, and `app/`.

## 2. Root Cause Analysis
1. **Missing Root Client Provider Boundary (`app/providers.tsx`)**:
   - `app/layout.tsx` is a Server Component (defining `metadata`). Directly importing context providers inside the Server Component root without a dedicated `"use client"` provider boundary (`app/providers.tsx`) violates the clean client/server boundary pattern in Next.js App Router.
2. **Duplicate & Fragmented Page-Level Providers**:
   - Multiple page components (`app/page.tsx`, `app/dashboard/page.tsx`, `app/demo/page.tsx`, `app/booking/page.tsx`, and several `app/ai-planner/*` pages) wrapped their inner layouts with duplicate `<MissionProvider>` tags.
   - This fragmented the React Context tree: navigating between pages re-mounted and re-initialized isolated `MissionProvider` instances, resetting project state, active agent statuses, and audit activity.
3. **Unprotected Pages & Sidebar Rendering**:
   - Pages such as `app/ai-planner/monitoring/page.tsx` and `app/ai-planner/analytics/page.tsx` rendered `<AppShell>` (which renders `<Sidebar />` calling `useMission()`), or called `useMission()` directly at the top level without local wrappers.
   - Any inconsistency in provider tree hierarchy or direct access caused `useMission()` to fail when the context was not cleanly provided from the root.

## 3. Corrective Plan
1. **Create `app/providers.tsx`**:
   - Export a `"use client"` `Providers` component wrapping children with `MissionProvider`.
2. **Update `app/layout.tsx`**:
   - Import `Providers` and wrap `{children}` inside `<html><body><Providers>{children}</Providers></body></html>`.
3. **Refactor `lib/mission-context.tsx`**:
   - Ensure `useMission` maintains the strict null check with an informative error message.
   - Verify named exports `MissionProvider` and `useMission`, memoization, SSR safety, and API stability.
4. **Clean Up Redundant Page-Level Providers**:
   - Remove redundant `<MissionProvider>` wrappers from `app/page.tsx`, `app/dashboard/page.tsx`, `app/demo/page.tsx`, `app/booking/page.tsx`, and all `app/ai-planner/*/page.tsx` files so that the entire application consistently shares the single root `MissionProvider`.
5. **Verify and Test**:
   - Run type checking and production build.
   - Add automated provider tests to guarantee `useMission` and `Sidebar` function seamlessly across the root provider tree.
