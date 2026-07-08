"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePipeline, LS_KEY } from "@/lib/pipeline-context";

const FORM_KEY = "exameval_form";

type Field = { label: string; key: keyof FormState; placeholder: string };

interface FormState {
  qp_url: string;
  qp_metadata_raw: string;
  ms_url: string;
  ms_metadata_raw: string;
}

const FIELDS: Field[] = [
  { label: "Question Paper URL",  key: "qp_url",          placeholder: "https://…/question-paper.pdf" },
  { label: "QP Metadata",         key: "qp_metadata_raw", placeholder: "e.g. Edexcel GCSE Mathematics 2023 Paper 1H" },
  { label: "Mark Scheme URL",     key: "ms_url",           placeholder: "https://…/mark-scheme.pdf" },
  { label: "MS Metadata",         key: "ms_metadata_raw",  placeholder: "e.g. Edexcel GCSE Mathematics 2023 Paper 1H Mark Scheme" },
];

// Prepend https:// to a schemeless link (e.g. "www.x.com/a.pdf"), mirroring the
// backend _normalize_url so the button enables for bare domains. The backend
// normalizes again on receipt, so sending the raw value is fine.
function normalizeUrl(v: string): string {
  const s = v.trim();
  return s && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? "https://" + s : s;
}

// Only require a well-formed URL. We normalize a missing scheme first (bare domain
// → https://), then let the browser's URL parser decide validity — the frontend no
// longer enforces the scheme itself. Whether the link actually yields a PDF (direct,
// ?pdf= proxy, or embedded in HTML) is resolved server-side at download time.
function isValidUrl(url: string): boolean {
  const n = normalizeUrl(url);
  try {
    new URL(n); // must parse (rejects spaces, control chars, etc.)
  } catch {
    return false;
  }
  // Require a dot in the RAW host token so bare text (e.g. "biologypaper", "1234")
  // is rejected. We can't use URL.hostname here — it coerces "1234" into an IP with
  // dots. This mirrors the backend's `"." in netloc`.
  const host = n.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0];
  return host.includes(".");
}

// True if the text looks like a URL (used to reject links in the metadata fields).
function looksLikeUrl(v: string): boolean {
  return /^https?:\/\/\S+/i.test(v.trim());
}

// Per-field validation message, or null if the field is empty or valid.
// Empty fields return null so the form doesn't load covered in red; the submit
// button is still disabled until every field is filled (see isFormValid).
function fieldError(key: keyof FormState, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (key === "qp_url" || key === "ms_url") {
    if (!isValidUrl(v))
      return "Enter a valid link.";
  } else {
    if (looksLikeUrl(v))
      return "Enter the paper details (e.g. 'AQA GCSE Biology 2023 Paper 1H'), not a URL.";
  }
  return null;
}

export default function HomePage() {
  const router = useRouter();
  const { phase, statusMsg, progress, paperId, start, reset } = usePipeline();
  const [form, setForm] = useState<FormState>({
    qp_url: "", qp_metadata_raw: "", ms_url: "", ms_metadata_raw: "",
  });

  // Restore the fields after a refresh ONLY while a run is actually in progress
  // (a job id is stored). On an idle reload — no active job — start blank and drop
  // any stale saved form, so inputs are kept mid-run but not when idle.
  useEffect(() => {
    try {
      const hasActiveJob = localStorage.getItem(LS_KEY);
      const saved = localStorage.getItem(FORM_KEY);
      if (hasActiveJob && saved) {
        setForm(JSON.parse(saved));
      } else {
        localStorage.removeItem(FORM_KEY);
      }
    } catch { /* ignore malformed storage */ }
  }, []);

  // Once a run ends, stop retaining the inputs across reloads.
  useEffect(() => {
    if (phase === "done" || phase === "error") {
      try { localStorage.removeItem(FORM_KEY); } catch { /* ignore */ }
    }
  }, [phase]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    try { localStorage.setItem(FORM_KEY, JSON.stringify(form)); } catch { /* ignore */ }
    await start(form);
  }

  // Real-time validation — mirrors the backend so the button and the API agree.
  const sameUrl =
    form.qp_url.trim() !== "" && form.qp_url.trim() === form.ms_url.trim();
  const allFilled = FIELDS.every(({ key }) => form[key].trim() !== "");
  const noFieldErrors = FIELDS.every(({ key }) => !fieldError(key, form[key]));
  const isFormValid = allFilled && noFieldErrors && !sameUrl;

  return (
    <div className="max-w-2xl mx-auto">

      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Run Pipeline</h1>
        <p className="mt-2 text-slate-500 text-sm leading-relaxed">
          Paste the PDF links and metadata for a past paper and its mark scheme.
          The pipeline extracts questions, generates AI student answers, grades them,
          and stores everything in the database.
        </p>
      </div>

      {/* Form */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Paper Details</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 gap-5">
            {FIELDS.map(({ label, key, placeholder }) => {
              // Show the same-URL warning under the Mark Scheme URL field.
              const err = fieldError(key, form[key])
                ?? (key === "ms_url" && sameUrl
                    ? "The Mark Scheme URL is identical to the Question Paper URL - they must be two different PDFs."
                    : null);
              return (
                <div key={key}>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
                  <input
                    type="text"
                    required
                    value={form[key]}
                    placeholder={placeholder}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    disabled={phase === "running"}
                    aria-invalid={err ? true : undefined}
                    className={`w-full border rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400 transition-shadow ${
                      err
                        ? "border-red-300 focus:ring-red-500"
                        : "border-slate-300 focus:ring-blue-500"
                    }`}
                  />
                  {err && <p className="mt-1.5 text-xs text-red-600">{err}</p>}
                </div>
              );
            })}
          </div>

          <button
            type="submit"
            disabled={phase === "running" || !isFormValid}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-colors shadow-sm mt-2"
          >
            {phase === "running" ? "Pipeline running…" : "Run Pipeline"}
          </button>
        </form>
      </div>

      {/* Status panel */}
      {phase !== "idle" && (
        <div className={`mt-5 rounded-2xl border p-5 ${
          phase === "error" ? "bg-red-50 border-red-200"
          : phase === "done" ? "bg-emerald-50 border-emerald-200"
          : "bg-blue-50 border-blue-200"
        }`}>

          {/* Status line */}
          <div className="flex items-center gap-3 mb-4">
            {phase === "running" && (
              <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
            {phase === "done" && (
              <span className="inline-flex items-center justify-center w-5 h-5 bg-emerald-500 rounded-full flex-shrink-0">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            )}
            {phase === "error" && (
              <span className="inline-flex items-center justify-center w-5 h-5 bg-red-500 rounded-full flex-shrink-0 text-white text-xs font-bold">✕</span>
            )}
            <span className={`text-sm font-semibold whitespace-pre-line ${
              phase === "error" ? "text-red-700"
              : phase === "done" ? "text-emerald-700"
              : "text-blue-700"
            }`}>
              {statusMsg}
            </span>
          </div>

          {/* Progress bar */}
          {(phase === "running" || phase === "done") && (
            <>
              <div className="w-full bg-white/60 rounded-full h-2.5 overflow-hidden border border-white/80">
                <div
                  className={`h-2.5 rounded-full transition-all duration-700 ease-out ${
                    phase === "done" ? "bg-emerald-500" : "bg-blue-500"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-blue-500">
                <span className="text-slate-400">Progress</span>
                <span className="font-semibold">{progress}%</span>
              </div>
            </>
          )}

          {/* Warning */}
          {phase === "running" && (
            <p className="mt-3 text-xs text-blue-600 bg-blue-100 rounded-lg px-3 py-2 text-center">
              ⚠ Do not close or refresh this page while the pipeline is running.
            </p>
          )}

          {/* CTAs */}
          {phase === "done" && paperId && (
            <button
              onClick={() => router.push(`/papers/${paperId}`)}
              className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl py-2.5 text-sm transition-colors shadow-sm"
            >
              View Results →
            </button>
          )}
          {(phase === "done" || phase === "error") && (
            <button
              onClick={reset}
              className="mt-2 w-full text-sm text-slate-500 hover:text-slate-700 underline"
            >
              Run another pipeline
            </button>
          )}
        </div>
      )}
    </div>
  );
}
