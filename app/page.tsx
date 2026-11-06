"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { 
  Users, 
  PlaySquare, 
  FileCheck, 
  FileSpreadsheet, 
  Activity, 
  Download, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Eye,
  FileText,
  X,
  Terminal,
  ShoppingBag,
  Trash2,
  Trash
} from "lucide-react";

interface Account {
  id: string;
  name: string;
  isEnabled: boolean;
}

interface PipelineRun {
  id: string;
  accountId: string | null;
  accountName: string | null;
  status: string;
  orderCount: number;
  duration: string;
  runDir: string;
  pdfPath: string | null;
  excelPath: string | null;
  startedAt: string;
}

interface RunDetail {
  run: PipelineRun;
  postingsCount: number;
  postings: Array<{
    postingNumber: string;
    status: string;
    customerName: string;
    productsCount: number;
    products: string;
  }>;
  logContent: string;
}

export default function DashboardHome() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAccountId, setRunningAccountId] = useState<string | null>(null);

  // Checkbox selection state for bulk delete
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());

  // Detail Modal state
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [accRes, runsRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/runs"),
      ]);
      const accData = await accRes.json();
      const runsData = await runsRes.json();
      setAccounts(Array.isArray(accData) ? accData : []);
      setRuns(Array.isArray(runsData) ? runsData : []);
      setSelectedRunIds(new Set());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRunPipeline = async (accountId: string) => {
    setRunningAccountId(accountId);
    try {
      await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      await fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setRunningAccountId(null);
    }
  };

  const openDetailsModal = async (runId: string) => {
    setSelectedRunId(runId);
    setLoadingDetail(true);
    setRunDetail(null);
    try {
      const res = await fetch(`/api/runs/${runId}`);
      const data = await res.json();
      setRunDetail(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Delete Handlers with explicit Confirmation Dialogs
  const handleDeleteSingle = async (runId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm("Are you sure you want to delete this pipeline run? This will remove its DB record, PDF, Excel, and log files.")) {
      return;
    }

    try {
      await fetch(`/api/runs/${runId}`, { method: "DELETE" });
      if (selectedRunId === runId) setSelectedRunId(null);
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedRunIds);
    if (ids.length === 0) return;

    if (!confirm(`Are you sure you want to delete ${ids.length} selected pipeline run(s)? This will remove their DB records and generated files.`)) {
      return;
    }

    try {
      await fetch("/api/runs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteAllHistory = async () => {
    if (!confirm("⚠️ WARNING: Are you sure you want to CLEAR ALL pipeline execution history? This will delete all DB records, PDFs, Excels, and logs. Seller accounts will NOT be deleted.")) {
      return;
    }

    try {
      await fetch("/api/runs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setSelectedRunId(null);
      await fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleSelectAllRuns = () => {
    if (selectedRunIds.size === runs.length) {
      setSelectedRunIds(new Set());
    } else {
      setSelectedRunIds(new Set(runs.map((r) => r.id)));
    }
  };

  const toggleSelectRun = (id: string) => {
    const next = new Set(selectedRunIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRunIds(next);
  };

  const enabledAccounts = accounts.filter((a) => a.isEnabled);
  const lastRun = runs[0] || null;
  const lastSuccessWithPdf = runs.find((r) => r.pdfPath && r.pdfPath.trim().length > 0);
  const lastSuccessWithExcel = runs.find((r) => r.excelPath && r.excelPath.trim().length > 0);

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
    <div className="space-y-8">
      {/* Header & Quick Action Banner */}
      <div className="glass-card p-6 rounded-2xl border border-gray-800/80 bg-[#111827]/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Automation Dashboard</h2>
          <p className="text-sm text-gray-400 mt-1">
            Monitor real-time pipeline executions and trigger order processing.
          </p>
        </div>

        {enabledAccounts.length > 0 && (
          <div className="flex items-center space-x-3">
            <select
              id="quickRunSelect"
              className="bg-gray-950 border border-gray-800 text-sm text-gray-100 rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-purple-500 focus:outline-none"
              defaultValue={enabledAccounts[0]?.id}
            >
              {enabledAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                const el = document.getElementById("quickRunSelect") as HTMLSelectElement;
                if (el?.value) handleRunPipeline(el.value);
              }}
              disabled={!!runningAccountId}
              className="flex items-center space-x-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold px-4.5 py-2.5 rounded-xl shadow-lg shadow-purple-900/30 transition disabled:opacity-50"
            >
              <PlaySquare className="w-4 h-4" />
              <span>{runningAccountId ? "Executing..." : "Run Pipeline"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="glass-card p-5 rounded-2xl border border-gray-800/80 bg-[#111827]/40 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase font-semibold text-gray-400 tracking-wider">Seller Accounts</p>
            <p className="text-2xl font-extrabold text-white mt-1.5">{accounts.length}</p>
            <p className="text-[11px] text-purple-400 mt-1">{enabledAccounts.length} active stores</p>
          </div>
          <div className="p-3 bg-purple-500/10 rounded-2xl text-purple-400 border border-purple-500/20">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="glass-card p-5 rounded-2xl border border-gray-800/80 bg-[#111827]/40 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase font-semibold text-gray-400 tracking-wider">Pipeline Status</p>
            <p className="text-base font-bold text-white mt-1.5 flex items-center space-x-2">
              {runningAccountId ? (
                <span className="text-yellow-400 flex items-center space-x-1.5">
                  <Activity className="w-4 h-4 animate-spin" />
                  <span>Running</span>
                </span>
              ) : lastRun?.status === "completed" ? (
                <span className="text-emerald-400 flex items-center space-x-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Idle (Ready)</span>
                </span>
              ) : (
                <span className="text-gray-400">Idle</span>
              )}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              {lastRun ? `${lastRun.orderCount} orders last run` : "No runs recorded"}
            </p>
          </div>
          <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-400 border border-indigo-500/20">
            <Activity className="w-5 h-5" />
          </div>
        </div>

        <div className="glass-card p-5 rounded-2xl border border-gray-800/80 bg-[#111827]/40 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase font-semibold text-gray-400 tracking-wider">Last Generated PDF</p>
            {lastSuccessWithPdf?.pdfPath ? (
              <a
                href={`/api/download?path=${encodeURIComponent(lastSuccessWithPdf.pdfPath)}`}
                className="mt-1.5 inline-flex items-center space-x-1.5 text-xs font-semibold text-purple-400 hover:text-purple-300 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download final.pdf</span>
              </a>
            ) : (
              <p className="text-xs text-gray-500 mt-1.5">None available</p>
            )}
            <p className="text-[11px] text-gray-400 mt-1">
              {lastSuccessWithPdf ? formatMoscowDate(lastSuccessWithPdf.startedAt) : "-"}
            </p>
          </div>
          <div className="p-3 bg-purple-500/10 rounded-2xl text-purple-400 border border-purple-500/20">
            <FileCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="glass-card p-5 rounded-2xl border border-gray-800/80 bg-[#111827]/40 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase font-semibold text-gray-400 tracking-wider">Last Generated Excel</p>
            {lastSuccessWithExcel?.excelPath ? (
              <a
                href={`/api/download?path=${encodeURIComponent(lastSuccessWithExcel.excelPath)}`}
                className="mt-1.5 inline-flex items-center space-x-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download report.xlsx</span>
              </a>
            ) : (
              <p className="text-xs text-gray-500 mt-1.5">None available</p>
            )}
            <p className="text-[11px] text-gray-400 mt-1">
              {lastSuccessWithExcel ? formatMoscowDate(lastSuccessWithExcel.startedAt) : "-"}
            </p>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-2xl text-emerald-400 border border-emerald-500/20">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Clean Table Layout for Recent Pipeline Executions & Delete Actions */}
      <div className="glass-card p-6 rounded-2xl border border-gray-800/80 bg-[#111827]/50 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight flex items-center space-x-2">
              <Clock className="w-5 h-5 text-purple-400" />
              <span>Recent Pipeline Executions</span>
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Timezone: <strong className="text-gray-300">Europe/Moscow (UTC+3)</strong>
            </p>
          </div>

          {/* Delete Action Controls */}
          {runs.length > 0 && (
            <div className="flex items-center space-x-2">
              {selectedRunIds.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center space-x-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold px-3 py-1.5 rounded-xl transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Selected ({selectedRunIds.size})</span>
                </button>
              )}

              <button
                onClick={handleDeleteAllHistory}
                className="flex items-center space-x-1.5 bg-gray-900 hover:bg-rose-950/40 text-gray-400 hover:text-rose-300 border border-gray-800 hover:border-rose-500/30 text-xs font-semibold px-3 py-1.5 rounded-xl transition"
              >
                <Trash className="w-3.5 h-3.5" />
                <span>Delete All History</span>
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-500 text-xs">Loading pipeline execution history...</div>
        ) : runs.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-xs">No pipeline runs recorded yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800/80">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase bg-gray-900/90 text-gray-400 border-b border-gray-800 font-semibold tracking-wider">
                <tr>
                  <th className="px-3 py-3.5 w-8">
                    <input
                      type="checkbox"
                      checked={selectedRunIds.size === runs.length && runs.length > 0}
                      onChange={toggleSelectAllRuns}
                      className="w-4 h-4 rounded bg-gray-950 border-gray-700 text-purple-600 focus:ring-purple-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3.5">Run Date (Moscow Time)</th>
                  <th className="px-4 py-3.5">Seller Account</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Orders</th>
                  <th className="px-4 py-3.5">Duration</th>
                  <th className="px-4 py-3.5 text-center">PDF</th>
                  <th className="px-4 py-3.5 text-center">Excel</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60 font-medium">
                {runs.map((run) => {
                  const isChecked = selectedRunIds.has(run.id);
                  return (
                    <tr key={run.id} className={`hover:bg-gray-800/40 transition ${isChecked ? "bg-purple-950/20" : ""}`}>
                      <td className="px-3 py-3.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectRun(run.id)}
                          className="w-4 h-4 rounded bg-gray-950 border-gray-700 text-purple-600 focus:ring-purple-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3.5 font-mono text-gray-200">
                        {formatMoscowDate(run.startedAt)}
                      </td>
                      <td className="px-4 py-3.5 text-white font-semibold">
                        {run.accountName || "Frostrek LLP"}
                      </td>
                      <td className="px-4 py-3.5">
                        {run.status === "completed" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Completed
                          </span>
                        ) : run.status === "running" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                            Running
                          </span>
                        ) : run.status === "skipped" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-gray-500/10 text-gray-400 border border-gray-500/20">
                            No Orders
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            Failed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-gray-200 font-mono font-bold">{run.orderCount}</td>
                      <td className="px-4 py-3.5 text-gray-400">{run.duration || "-"}</td>
                      <td className="px-4 py-3.5 text-center">
                        {run.pdfPath ? (
                          <a
                            href={`/api/download?path=${encodeURIComponent(run.pdfPath)}`}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-purple-600/15 text-purple-300 hover:bg-purple-600/30 border border-purple-500/30 transition"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>PDF</span>
                          </a>
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {run.excelPath ? (
                          <a
                            href={`/api/download?path=${encodeURIComponent(run.excelPath)}`}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 transition"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            <span>Excel</span>
                          </a>
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right flex items-center justify-end space-x-2">
                        <button
                          onClick={() => openDetailsModal(run.id)}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition"
                        >
                          <Eye className="w-3.5 h-3.5 text-purple-400" />
                          <span>Details</span>
                        </button>
                        <button
                          onClick={(e) => handleDeleteSingle(run.id, e)}
                          className="p-1 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                          title="Delete Pipeline Run"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {selectedRunId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="glass-card max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col border border-gray-700 shadow-2xl rounded-2xl bg-[#111827]">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-800 flex items-center justify-between bg-gray-900/80">
              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Pipeline Execution Details
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Seller Account: <strong className="text-gray-200">{runDetail?.run.accountName || "Frostrek LLP"}</strong>
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleDeleteSingle(selectedRunId)}
                  className="flex items-center space-x-1 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10 rounded-lg border border-rose-500/20 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Run</span>
                </button>
                <button
                  onClick={() => setSelectedRunId(null)}
                  className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {loadingDetail ? (
                <div className="py-12 text-center text-gray-500">Loading run details...</div>
              ) : runDetail ? (
                <>
                  {/* Status Banner */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-950 p-4 rounded-xl border border-gray-900 font-mono">
                    <div>
                      <span className="text-gray-500 block">Status</span>
                      <span className="text-emerald-400 font-bold uppercase">{runDetail.run.status}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Total Orders</span>
                      <span className="text-white font-bold">{runDetail.postingsCount}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Duration</span>
                      <span className="text-white font-bold">{runDetail.run.duration || "-"}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Run Date (MSK)</span>
                      <span className="text-white font-bold">
                        {formatMoscowDate(runDetail.run.startedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Actions & File Links */}
                  <div className="flex items-center space-x-3 pt-1">
                    {runDetail.run.pdfPath && (
                      <a
                        href={`/api/download?path=${encodeURIComponent(runDetail.run.pdfPath)}`}
                        className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-md"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download Invoice PDF</span>
                      </a>
                    )}
                    {runDetail.run.excelPath && (
                      <a
                        href={`/api/download?path=${encodeURIComponent(runDetail.run.excelPath)}`}
                        className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-md"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download Shipment Excel</span>
                      </a>
                    )}
                  </div>

                  {/* Orders List */}
                  {runDetail.postings.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-bold text-gray-300 flex items-center space-x-1.5 uppercase tracking-wider text-[11px]">
                        <ShoppingBag className="w-3.5 h-3.5 text-purple-400" />
                        <span>Processed Orders ({runDetail.postings.length})</span>
                      </h4>
                      <div className="bg-gray-950 border border-gray-900 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-900 text-gray-400 uppercase text-[10px]">
                            <tr>
                              <th className="px-3 py-2">Posting #</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">Customer</th>
                              <th className="px-3 py-2">Products</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-900">
                            {runDetail.postings.map((p) => (
                              <tr key={p.postingNumber} className="hover:bg-gray-900/40">
                                <td className="px-3 py-2 font-mono text-purple-300">{p.postingNumber}</td>
                                <td className="px-3 py-2 text-gray-400">{p.status}</td>
                                <td className="px-3 py-2 text-gray-300">{p.customerName}</td>
                                <td className="px-3 py-2 text-gray-400 truncate max-w-xs">{p.products}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Log View */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-gray-300 flex items-center space-x-1.5 uppercase tracking-wider text-[11px]">
                      <Terminal className="w-3.5 h-3.5 text-purple-400" />
                      <span>Execution Logs</span>
                    </h4>
                    <pre className="bg-gray-950 border border-gray-900 text-gray-300 p-4 rounded-xl font-mono text-[11px] max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {runDetail.logContent}
                    </pre>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
