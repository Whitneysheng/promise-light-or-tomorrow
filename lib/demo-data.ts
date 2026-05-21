import type { Fragment, Performance } from "@/lib/types";

export const demoPerformance: Performance = {
  id: "demo-performance",
  title: "promise light or tomorrow",
  slug: "promise-light-or-tomorrow",
  status: "open",
  seed: null,
  created_at: new Date(0).toISOString(),
  closed_at: null,
};

export const demoFragments: Fragment[] = [
  "Promise light or tomorrow",
  "No one promised light or tomorrow",
  "Memory can collapse time",
  "Debt is its own reward",
  "Just a length of rope, baby",
  "Other homes are possible",
  "The violets",
  "Piano dust",
  "You might not be able to tell but this is a love poem",
  "All speech is a presumption, to answer tomorrow",
  "Perhaps every time I said Love, I meant History",
  "Love is my first choice, but",
  "The better things can only be gathered by a pen",
  "It's spring now",
].map((text, index) => ({
  id: `demo-fragment-${index + 1}`,
  performance_id: demoPerformance.id,
  text,
  display_order: index + 1,
}));

export function demoModeEnabled() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
