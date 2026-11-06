"use client";

import { useEffect, useState } from "react";
import { Search, FileText, FileSpreadsheet, Download, RefreshCw, AlertCircle, Globe, Clock, Settings, Save, Check } from "lucide-react";

interface Account {
  id: string;
  name: string;
  isEnabled: boolean;
}

export default function HistoricalReportsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  
  // Pipeline Execution Time setting (default 10:30 IST)
  const [executionTime, setExecutionTime] = useState("10:30");
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [tempTime, setTempTime] = useState("10:30");

  // Posting number range filter
  const [startPostingNumber, setStartPostingNumber] = useState("");
  const [endPostingNumber, setEndPostingNumber] = useState("");

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);
  
  const [statuses, setStatuses] = useState<Record<string, boolean>>({
    awaiting_packaging: true,
    awaiting_deliver: true,
    delivering: true,
    delivered: true,
    cancelled: false,
  });

  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrderNumbers, setSelectedOrderNumbers] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [generatedResult, setGeneratedResult] = useState<{
    pdfPath: string;
    excelPath: string;
    orderCount: number;
  } | null>(null);

  useEffect(() => {
    fetchAccounts();
    fetchExecutionTimeSetting();
  }, []);

  const fetchAccounts = async () => {
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setAccounts(data);
        setSelectedAccountId(data[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchExecutionTimeSetting = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data.executionTime) {
        setExecutionTime(data.executionTime);
        setTempTime(data.executionTime);
      }
    } catch (e) {}
  };

  const handleSaveExecutionTime = async () => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionTime: tempTime }),
      });
      if (res.ok) {
        setExecutionTime(tempTime);
        setIsEditingTime(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleFetchOrders = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setGeneratedResult(null);
    setFetching(true);
    setOrders([]);

    const selectedStatuses = Object.keys(statuses).filter((s) => statuses[s]);

    try {
      const res = await fetch("/api/historical/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccountId,
          fromDate,
          toDate,
          statuses: selectedStatuses,
          executionTime,
          startPostingNumber: startPostingNumber || undefined,
          endPostingNumber: endPostingNumber || undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to fetch historical orders");
      }

      const data = await res.json();
      const fetchedOrders = data.orders || [];
      setOrders(fetchedOrders);
      setSelectedOrderNumbers(new Set(fetchedOrders.map((o: any) => o.posting_number)));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFetching(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedOrderNumbers.size === orders.length) {
      setSelectedOrderNumbers(new Set());
    } else {
      setSelectedOrderNumbers(new Set(orders.map((o) => o.posting_number)));
    }
  };

  const toggleSelectOrder = (postingNumber: string) => {
    const next = new Set(selectedOrderNumbers);
    if (next.has(postingNumber)) {
      next.delete(postingNumber);
    } else {
      next.add(postingNumber);
    }
    setSelectedOrderNumbers(next);
  };

  const handleGenerateReport = async () => {
    const targetOrders = orders.filter((o) => selectedOrderNumbers.has(o.posting_number));
    if (targetOrders.length === 0) {
      setError("Please select at least one order to generate a report.");
      return;
    }

    setGenerating(true);
    setError("");
    setGeneratedResult(null);

    try {
      const res = await fetch("/api/historical/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccountId,
          orders: targetOrders,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to generate report");
      }

      const result = await res.json();
      setGeneratedResult(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  function formatDisplayWindowDate(dateStr: string, timeStr: string) {
    if (!dateStr) return "-";
    try {
      const d = new Date(`${dateStr}T${timeStr}:00+05:30`);
      return d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }) + ` ${timeStr} IST`;
    } catch {
      return `${dateStr} ${timeStr} IST`;
    }
  }

  function formatIndianTime(isoString: string) {
    if (!isoString) return "-";
    try {
      return new Date(isoString).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) + " IST";
    } catch {
      return isoString;
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Historical Reports</h2>
          <p className="text-sm text-gray-400 mt-1">
            Generate reports for past Ozon orders based on your daily pipeline execution window.
          </p>
        </div>

        {/* Execution Time Settings Button */}
        <div className="flex items-center space-x-3">
          <div className="inline-flex items-center space-x-2 bg-purple-950/40 border border-purple-800/40 px-3.5 py-2 rounded-xl text-xs font-semibold text-purple-300">
            <Clock className="w-4 h-4 text-purple-400" />
            <span>Daily Execution: <strong>{executionTime} IST</strong></span>
          </div>

          <button
            onClick={() => setIsEditingTime(!isEditingTime)}
            className="p-2 text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-xl transition"
            title="Configure Pipeline Execution Time"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Settings Modal / Input toggle */}
      {isEditingTime && (
        <div className="glass-card p-4 rounded-2xl border border-purple-500/40 bg-purple-950/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2 text-purple-200">
            <span>Configure Pipeline Execution Time (Asia/Kolkata):</span>
            <input
              type="text"
              value={tempTime}
              onChange={(e) => setTempTime(e.target.value)}
              placeholder="10:30"
              className="bg-gray-950 border border-purple-500/50 text-white text-xs font-mono font-bold rounded-lg px-2.5 py-1 w-20 text-center"
            />
            <span className="text-gray-400">IST</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsEditingTime(false)}
              className="px-3 py-1 text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveExecutionTime}
              className="flex items-center space-x-1 bg-purple-600 hover:bg-purple-500 text-white font-semibold px-3 py-1 rounded-lg transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Time</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter Form & Pipeline Window Display */}
      <form onSubmit={handleFetchOrders} className="glass-card p-6 rounded-2xl border border-gray-800/80 space-y-6 bg-[#111827]/60">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Seller Account
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 text-gray-100 text-sm rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-purple-500 focus:outline-none"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 text-gray-100 text-sm rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 text-gray-100 text-sm rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-purple-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Pipeline Execution Window Card */}
        <div className="bg-gray-950/80 border border-gray-800/90 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-purple-400" />
            <span className="font-semibold text-gray-300">Pipeline Execution Window (IST):</span>
          </div>

          <div className="flex items-center space-x-4 font-mono">
            <div>
              <span className="text-gray-500 mr-1.5">Start:</span>
              <span className="text-purple-300 font-bold">
                {formatDisplayWindowDate(fromDate, executionTime)}
              </span>
            </div>
            <span className="text-gray-600">→</span>
            <div>
              <span className="text-gray-500 mr-1.5">End:</span>
              <span className="text-purple-300 font-bold">
                {formatDisplayWindowDate(toDate, executionTime)}
              </span>
            </div>
          </div>
        </div>

        {/* Posting Number Range Filter */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Posting Number Range (Optional)
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Start Posting Number</label>
              <input
                type="text"
                value={startPostingNumber}
                onChange={(e) => setStartPostingNumber(e.target.value.trim())}
                placeholder="e.g. 38073147-0210-2"
                className="w-full bg-gray-950 border border-gray-800 text-gray-100 text-sm rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-purple-500 focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">End Posting Number</label>
              <input
                type="text"
                value={endPostingNumber}
                onChange={(e) => setEndPostingNumber(e.target.value.trim())}
                placeholder="e.g. 45231549-0276-2"
                className="w-full bg-gray-950 border border-gray-800 text-gray-100 text-sm rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-purple-500 focus:outline-none font-mono"
              />
            </div>
          </div>
          <p className="text-[10px] text-gray-500 mt-1.5">Leave empty to fetch all orders in the date range. Both boundaries are inclusive.</p>
        </div>

        {/* Status Checkboxes */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Statuses to Include
          </label>
          <div className="flex flex-wrap gap-4 text-xs">
            {[
              { key: "awaiting_packaging", label: "Awaiting Packaging" },
              { key: "awaiting_deliver", label: "Awaiting Shipment" },
              { key: "delivering", label: "Shipped / Delivering" },
              { key: "delivered", label: "Delivered" },
              { key: "cancelled", label: "Cancelled" },
            ].map((st) => (
              <label key={st.key} className="flex items-center space-x-2 text-gray-300 cursor-pointer hover:text-white transition">
                <input
                  type="checkbox"
                  checked={statuses[st.key]}
                  onChange={(e) =>
                    setStatuses((prev) => ({ ...prev, [st.key]: e.target.checked }))
                  }
                  className="w-4 h-4 rounded bg-gray-950 border-gray-700 text-purple-600 focus:ring-purple-500"
                />
                <span>{st.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={fetching}
            className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-lg shadow-purple-900/40 transition disabled:opacity-50"
          >
            <Search className="w-4 h-4" />
            <span>{fetching ? "Fetching Orders from Ozon..." : "Fetch Historical Orders"}</span>
          </button>
        </div>
      </form>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Generated Result Banner */}
      {generatedResult && (
        <div className="glass-card p-6 rounded-2xl border-l-4 border-l-emerald-500 space-y-3 bg-[#111827]/80">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Historical Report Generated ({generatedResult.orderCount} orders)</span>
          </h3>
          <p className="text-xs text-gray-400">
            Reused existing translation, PDF invoice generator, and Excel export modules.
          </p>
          <div className="flex items-center space-x-3 pt-2">
            <a
              href={`/api/download?path=${encodeURIComponent(generatedResult.pdfPath)}`}
              className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-md"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download PDF</span>
            </a>
            <a
              href={`/api/download?path=${encodeURIComponent(generatedResult.excelPath)}`}
              className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition shadow-md"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Excel</span>
            </a>
          </div>
        </div>
      )}

      {/* Orders Table */}
      {orders.length > 0 && (
        <div className="glass-card p-6 rounded-2xl border border-gray-800/80 space-y-4 bg-[#111827]/40">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white tracking-tight">
              Matching Orders ({orders.length})
            </h3>

            <div className="flex items-center space-x-4">
              <span className="text-xs text-gray-400">
                Selected: <strong className="text-gray-200">{selectedOrderNumbers.size} / {orders.length}</strong>
              </span>

              <button
                onClick={handleGenerateReport}
                disabled={generating || selectedOrderNumbers.size === 0}
                className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold px-4.5 py-2.5 rounded-xl transition shadow-md disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`} />
                <span>{generating ? "Generating PDFs & Excel..." : "Generate PDF & Excel"}</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-800/80">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase bg-gray-900/90 text-gray-400 border-b border-gray-800 font-semibold tracking-wider">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedOrderNumbers.size === orders.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded bg-gray-950 border-gray-700 text-purple-600 focus:ring-purple-500"
                    />
                  </th>
                  <th className="px-4 py-3">Posting Number</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Products</th>
                  <th className="px-4 py-3">In Process (IST)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {orders.map((order) => {
                  const isSelected = selectedOrderNumbers.has(order.posting_number);
                  return (
                    <tr
                      key={order.posting_number}
                      className={`hover:bg-gray-800/40 transition ${
                        isSelected ? "bg-purple-900/10" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOrder(order.posting_number)}
                          className="w-4 h-4 rounded bg-gray-950 border-gray-700 text-purple-600 focus:ring-purple-500"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-purple-300">
                        {order.posting_number}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-gray-800 text-gray-300">
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-200">
                        {order.customer?.name || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-gray-400 max-w-xs truncate">
                        {order.products?.map((p: any) => p.name).join(", ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-400 font-mono">
                        {formatIndianTime(order.in_process_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
