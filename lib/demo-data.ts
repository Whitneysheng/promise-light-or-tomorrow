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
  "A door remembers every hand",
  "The room was listening before us",
  "I kept the future in my mouth",
  "Your name arrived as weather",
  "History sits beside the cup",
  "The lamp keeps choosing us",
  "Some promises are made of air",
  "I wanted the ordinary to stay",
  "The street answered softly",
  "Tomorrow had no witness yet",
].map((text, index) => ({
  id: `demo-fragment-${index + 1}`,
  performance_id: demoPerformance.id,
  text,
  display_order: index + 1,
}));

export function demoModeEnabled() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
