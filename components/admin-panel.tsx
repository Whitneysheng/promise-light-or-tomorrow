"use client";

import {
  CheckCircle2,
  RefreshCcw,
  RotateCcw,
  Shuffle,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

type AdminData = {
  performance: {
    title: string;
    status: string;
    seed: string | null;
    closed_at: string | null;
  };
  fragments: unknown[];
  cues: unknown[];
  submissions: Array<{
    id: string;
    created_at: string;
    moderation_status?: "pending" | "approved" | "rejected";
    moderation_flags?: string[] | null;
    fragments?: { text: string };
  }>;
  assignments: Array<{
    id: string;
    cues?: { label: string };
    submissions?: { fragments?: { text: string } };
  }>;
};

export function AdminPanel() {
  const [passcode, setPasscode] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadSummary() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not load admin panel.");
      return;
    }

    setData(payload);
  }

  async function closePerformance() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/close-performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not close performance.");
      return;
    }

    await loadSummary();
  }

  async function resetPerformance() {
    const confirmed = window.confirm(
      "This will reopen submissions and permanently delete all current recordings, submission rows, and cue assignments. Continue?",
    );

    if (!confirmed) return;

    setBusy(true);
    setError(null);
    const response = await fetch("/api/reset-performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not reset performance.");
      return;
    }

    await loadSummary();
  }

  async function reviewSubmissions() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/moderate-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passcode,
        action: "approve_clean_reject_flagged",
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not review submissions.");
      return;
    }

    await loadSummary();
  }

  const approvedCount =
    data?.submissions.filter(
      (submission) => submission.moderation_status === "approved",
    ).length ?? 0;
  const pendingSubmissions =
    data?.submissions.filter(
      (submission) =>
        !submission.moderation_status ||
        submission.moderation_status === "pending",
    ) ?? [];
  const flaggedPendingCount = pendingSubmissions.filter((submission) =>
    (submission.moderation_flags ?? []).some(
      (flag) => flag === "possible_mismatch" || flag === "possible_profanity",
    ),
  ).length;
  const cleanPendingCount = pendingSubmissions.length - flaggedPendingCount;

  return (
    <main className="console-shell">
      <section className="console-header">
        <div>
          <p className="eyebrow">admin</p>
          <h1>Performance setup</h1>
        </div>
        <a className="text-link" href="/perform">
          Open performer console
        </a>
      </section>

      <section className="toolbar">
        <label>
          <span>Admin passcode</span>
          <input
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadSummary();
            }}
          />
        </label>
        <button onClick={loadSummary} disabled={busy || !passcode}>
          <ShieldCheck size={18} />
          Unlock
        </button>
        <button
          className="secondary"
          onClick={loadSummary}
          disabled={busy || !passcode}
        >
          <RefreshCcw size={18} />
          Refresh
        </button>
      </section>

      {error && <p className="error-text">{error}</p>}

      {data && (
        <>
          <section className="metric-grid">
            <div className="metric">
              <span>Status</span>
              <strong>{data.performance.status}</strong>
            </div>
            <div className="metric">
              <span>Approved</span>
              <strong>{approvedCount}</strong>
            </div>
            <div className="metric">
              <span>Pending clean</span>
              <strong>{cleanPendingCount}</strong>
            </div>
            <div className="metric">
              <span>Flagged</span>
              <strong>{flaggedPendingCount}</strong>
            </div>
            <div className="metric">
              <span>Cues</span>
              <strong>{data.cues.length}</strong>
            </div>
            <div className="metric">
              <span>Seed</span>
              <strong>{data.performance.seed ?? "not generated"}</strong>
            </div>
          </section>

          <section className="action-band">
            <div>
              <h2>Review submissions</h2>
              <p>
                Approves pending recordings with no flags and permanently
                deletes pending recordings flagged for possible mismatch or
                profanity.
              </p>
            </div>
            <button onClick={reviewSubmissions} disabled={busy || !passcode}>
              <CheckCircle2 size={18} />
              Reject flagged, approve clean
            </button>
          </section>

          <section className="action-band">
            <div>
              <h2>Close and randomize</h2>
              <p>
                This freezes this performance&apos;s mapping. Only approved
                recordings are randomized into solo, sequential, and staggered
                texture cues.
              </p>
            </div>
            <button onClick={closePerformance} disabled={busy || !passcode}>
              <Shuffle size={18} />
              Close submissions
            </button>
          </section>

          <section className="action-band warning-band">
            <div>
              <h2>Reset for a new test or performance</h2>
              <p>
                This reopens submissions and deletes the current recordings,
                submission rows, and cue map from Supabase.
              </p>
            </div>
            <button
              className="danger"
              onClick={resetPerformance}
              disabled={busy || !passcode}
            >
              <RotateCcw size={18} />
              Reset and reopen
            </button>
          </section>

          <section className="two-column">
            <div>
              <h2>Recent submissions</h2>
              <div className="list">
                {data.submissions.map((submission) => (
                  <div className="list-row" key={submission.id}>
                    <strong>{submission.fragments?.text ?? "fragment"}</strong>
                    <div className="chip-row">
                      <span className="chip">
                        {submission.moderation_status ?? "pending"}
                      </span>
                      {(submission.moderation_flags ?? []).map((flag) => (
                        <span className="chip flag-chip" key={flag}>
                          {flag.replace("possible_", "possible ")}
                        </span>
                      ))}
                      <span>
                        {new Date(submission.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2>Cue map</h2>
              <div className="list">
                {data.assignments.map((assignment) => (
                  <div className="list-row" key={assignment.id}>
                    <strong>{assignment.cues?.label ?? "cue"}</strong>
                    <span>
                      {assignment.submissions?.fragments?.text ?? "silent fallback"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
