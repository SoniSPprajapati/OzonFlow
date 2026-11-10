"use client";

import { useEffect, useState } from "react";
import { Terminal, CheckCircle2, XCircle, Clock, Activity, AlertTriangle, Globe } from "lucide-react";

interface PipelineRun {
  id: string;
  accountName: string | null;
  status: string;
  orderCount: number;
  duration: string;
  runDir: string;
  pdfPath?: string | null;
  excelPath?: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export default function LogsPage() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/runs");
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setRuns(list);
      if (list.length > 0) setSelectedRun(list[0]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  function formatMoscowDate(dateStr: string) {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleString("en-GB", {
        timeZone: "Europe/Moscow",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) + " MSK";
    } catch {
      return dateStr;
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Execution Logs</h2>
          <p className="text-sm text-gray-400 mt-1">
            Inspect real-time system logs, execution durations, and failure tracebacks.
          </p>
        </div>

        <div className="inline-flex items-center space-x-2 bg-purple-950/40 border border-purple-800/40 px-3.5 py-2 rounded-xl text-xs font-semibold text-purple-300">
          <Globe className="w-4 h-4 text-purple-400" />
          <span>Timezone: <strong>Europe/Moscow (UTC+3)</strong></span>
        </div>
      </div>

      {loading ? (
        <div className="glass-card py-12 text-center text-gray-500 text-xs rounded-2xl">
          Loading log history...
        </div>
      ) : runs.length === 0 ? (
        <div className="glass-card py-12 text-center text-gray-500 text-xs rounded-2xl">
          No pipeline execution logs recorded yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Runs Sidebar */}
          <div className="glass-card p-4 rounded-2xl border border-gray-800/80 bg-[#111827]/60 space-y-2 max-h-[620px] overflow-y-auto">
            <h3 className="text-[11px] uppercase font-semibold text-gray-400 tracking-wider px-2 mb-2">
              Execution History ({runs.length})
            </h3>

            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => setSelectedRun(run)}
                className={`w-full text-left p-3.5 rounded-xl border transition space-y-1.5 ${
                  selectedRun?.id === run.id
                    ? "bg-purple-900/25 border-purple-500/50 text-white shadow-md"
                    : "bg-gray-950/40 border-gray-800/60 text-gray-300 hover:bg-gray-800/40"
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="truncate">{run.accountName || "Frostrek LLP"}</span>
                  {run.status === "completed" ? (
                    <span className="text-emerald-400 flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Completed</span>
                    </span>
                  ) : run.status === "running" ? (
                    <span className="text-yellow-400 flex items-center space-x-1">
                      <Activity className="w-3.5 h-3.5 animate-spin" />
                      <span>Running</span>
                    </span>
                  ) : (
                    <span className="text-rose-400 flex items-center space-x-1">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Failed</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono pt-0.5">
                  <span>{formatMoscowDate(run.startedAt)}</span>
                  <span>{run.duration || "-"}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Log Details Viewer */}
          <div className="lg:col-span-2 glass-card p-6 rounded-2xl border border-gray-800/80 bg-[#111827]/40 space-y-5">
            {selectedRun ? (
              <>
                <div className="flex items-center justify-between border-b border-gray-800/80 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white tracking-tight">
                      {selectedRun.accountName || "Frostrek LLP"}
                    </h3>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">
                      Run Dir: <span className="text-purple-400">{selectedRun.runDir}</span>
                    </p>
                  </div>

                  <span
                    className={`px-3 py-1 rounded-lg text-xs font-bold ${
                      selectedRun.status === "completed"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : selectedRun.status === "running"
                        ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    }`}
                  >
                    {selectedRun.status.toUpperCase()}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs font-medium bg-gray-950 p-4 rounded-xl border border-gray-900 font-mono">
                  <div>
                    <span className="text-gray-500 block">Orders Processed</span>
                    <span className="text-gray-100 text-sm font-bold">{selectedRun.orderCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Duration</span>
                    <span className="text-gray-100 text-sm font-bold">{selectedRun.duration || "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Run Date (MSK)</span>
                    <span className="text-gray-100 text-sm font-bold">
                      {formatMoscowDate(selectedRun.startedAt)}
                    </span>
                  </div>
                </div>

                {selectedRun.error && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-rose-400 uppercase tracking-wider flex items-center space-x-1.5">
                      <AlertTriangle className="w-4 h-4" />
                      <span>Error Message / Traceback</span>
                    </label>
                    <pre className="bg-rose-950/30 border border-rose-500/30 text-rose-200 p-4 rounded-xl text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                      {selectedRun.error}
                    </pre>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center space-x-1.5">
                    <Terminal className="w-4 h-4 text-purple-400" />
                    <span>Run Metadata Summary</span>
                  </label>
                  <div className="bg-gray-950 border border-gray-900 p-4 rounded-xl text-xs font-mono text-gray-300 space-y-1">
                    <p>[STATUS]: {selectedRun.status}</p>
                    <p>[ORDERS]: {selectedRun.orderCount}</p>
                    <p>[DURATION]: {selectedRun.duration || "0s"}</p>
                    <p>[DIRECTORY]: {selectedRun.runDir}</p>
                    {selectedRun.pdfPath && <p>[PDF]: {selectedRun.pdfPath}</p>}
                    {selectedRun.excelPath && <p>[EXCEL]: {selectedRun.excelPath}</p>}
                  </div>
                </div>
              </>
            ) : (
              <div className="py-12 text-center text-gray-500 text-xs">
                Select a run from the sidebar to inspect log details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
