"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Portfolio } from "@/lib/types";

interface ImportPreview {
  applied: boolean;
  meta: Portfolio["meta"];
  positions: Array<{
    code: string;
    name: string;
    assetClass: string;
    weight: number;
    amount: number;
  }>;
}

export function ExcelImport() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/import?preview=1", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as ImportPreview;
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!fileInputRef.current?.files?.[0]) return;
    const file = fileInputRef.current.files[0];

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv"
          onChange={handleFileSelect}
          disabled={loading || !!preview}
          className="text-sm"
        />
        {loading && <span className="text-xs text-[var(--ink-3)]">loading…</span>}
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {preview && (
        <div className="space-y-3 rounded border border-[var(--line)] p-3">
          <div>
            <div className="text-xs text-[var(--ink-3)]">File: {preview.meta.sourceFile}</div>
            <div className="text-sm font-semibold">{preview.meta.title}</div>
            <div className="text-xs text-[var(--ink-2)]">
              {preview.positions.length} position{preview.positions.length !== 1 ? "s" : ""} •{" "}
              ${(preview.meta.totalAmount / 1e6).toFixed(2)}M
            </div>
          </div>

          {preview.meta.warnings.length > 0 && (
            <div className="rounded bg-amber-500/10 p-2 text-xs text-amber-400">
              <div className="font-semibold">Warnings:</div>
              <ul className="mt-1 list-inside list-disc space-y-1">
                {preview.meta.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="px-2 py-1 text-left">Code</th>
                <th className="px-2 py-1 text-left">Name</th>
                <th className="px-2 py-1 text-left">Class</th>
                <th className="px-2 py-1 text-right">Weight</th>
                <th className="px-2 py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {preview.positions.slice(0, 10).map((p) => (
                <tr key={p.code} className="border-b border-[var(--line)]">
                  <td className="px-2 py-1 font-mono font-semibold">{p.code}</td>
                  <td className="px-2 py-1 truncate">{p.name}</td>
                  <td className="px-2 py-1 text-[10px]">{p.assetClass}</td>
                  <td className="px-2 py-1 text-right">{(p.weight * 100).toFixed(1)}%</td>
                  <td className="px-2 py-1 text-right">
                    ${(p.amount / 1e6).toFixed(2)}M
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {preview.positions.length > 10 && (
            <div className="text-xs text-[var(--ink-3)]">
              … and {preview.positions.length - 10} more
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleApply}
              disabled={loading}
              className="rounded border border-[var(--line)] bg-[var(--bg)] px-3 py-1 text-xs font-semibold text-[var(--ink-1)] hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:opacity-50"
            >
              {loading ? "Applying…" : "Apply"}
            </button>
            <button
              onClick={handleCancel}
              disabled={loading}
              className="rounded border border-[var(--line)] bg-[var(--bg)] px-3 py-1 text-xs text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
