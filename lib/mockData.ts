// Demo-brief defaults for the intake form on app/page.tsx.
//
// This file used to carry the whole fake dataset - vendors, bookings, a
// completed negotiation with an accepted 8% discount, a recovery script, an
// INC-001 incident. All of it rendered identically to real backend output,
// which is the worst possible failure mode for a demo whose claim is that
// nothing is scripted. Every one of those exports is gone; the pages now
// show honest empty states when the backend has no data.
//
// SCENARIO survives because it is a form PREFILL, not displayed output: it
// seeds the brief textarea so a demo does not start from a blank box.

import type { Scenario } from '@/lib/types';

export const SCENARIO: Scenario = {
  title: 'Rainforest Night Shoot — Agumbe',
  summary:
    '2 low-light rainforest scenes · 3-day shoot · ₹25.00L budget cap',
  description:
    'Two low-light rainforest scenes for a wildlife documentary series, shot over 3 consecutive days in the Agumbe rainforest belt. Requires low-light camera bodies, heavy fog-resistant lighting, silent generators, a licensed drone pilot with forest clearance, on-site insurance covering equipment and crew, transport for a 14-person crew from Bengaluru, and forest department permits for after-hours filming in a protected zone.',
  budgetCap: 2500000,
  shootDays: 3,
};
