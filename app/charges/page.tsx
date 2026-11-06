"use client";

import React, { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { 
  CreditCard, 
  Search, 
  ChevronDown, 
  ChevronUp,
  AlertTriangle,
  RefreshCw,
  Calendar,
  Box,
  Download,
  CheckSquare
} from "lucide-react";

export default function OrderCharges() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  // Default to August 1 to August 31, 2026 as per user example
  const [fromDate, setFromDate] = useState("2026-08-01");
  const [toDate, setToDate] = useState("2026-08-31");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [ozonUiTotals, setOzonUiTotals] = useState<Record<string, number>>({});

  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch("/api/accounts");
        if (res.ok) {
          const accs = await res.json();
          setAccounts(accs);
          if (accs.length > 0) {
            setSelectedAccountId(accs[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to load accounts", err);
      }
    }
    fetchAccounts();
  }, []);

  const loadCharges = async () => {
    if (!selectedAccountId || !fromDate || !toDate) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(
        `/api/charges?accountId=${selectedAccountId}&from=${fromDate}&to=${toDate}`
      );
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to load data");
      }
      const jsonData = await res.json();
      setData(jsonData);
      setSelectedOrders(new Set()); // clear selection on new load
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleOrder = (postingNumber: string) => {
    setExpandedOrders((prev) => ({
      ...prev,
      [postingNumber]: !prev[postingNumber],
    }));
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      minimumFractionDigits: 2,
    }).format(val || 0);
  };

  // ── Selection helpers ────────────────────────────────────────────────────
  const allOrders: any[] = data?.orders ?? [];
  const allSelected = allOrders.length > 0 && selectedOrders.size === allOrders.length;
  const someSelected = selectedOrders.size > 0 && !allSelected;

  const toggleSelectOrder = (postingNumber: string) => {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(postingNumber)) next.delete(postingNumber);
      else next.add(postingNumber);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(allOrders.map((o: any) => o.posting_number)));
    }
  };

  // ── CSV export ───────────────────────────────────────────────────────────
  const csvEscape = (val: any): string => {
    const str = val === null || val === undefined ? "" : String(val);
    // Always wrap in quotes; escape inner quotes by doubling them
    return `"${str.replace(/"/g, '""')}"`;
  };

  const downloadCSV = (orders: any[], filename: string) => {
    const headers = [
      "Order Number",
      "Posting Number",
      "Order Date",
      "Product",
      "SKU(s)",
      "Qty",
      "Order Value (RUB)",
      "Commission (RUB)",
      "Logistics (RUB)",
      "Returns (RUB)",
      "Partner Services (RUB)",
      "Promotion (RUB)",
      "Other (RUB)",
      "Total Ozon Deduction (RUB)",
      "Net Seller Amount (RUB)",
    ];

    const rows = orders.map((o: any) => [
      csvEscape(o.order_number),
      csvEscape(o.posting_number),
      csvEscape(o.order_date || ""),
      csvEscape(Array.isArray(o.product_names) ? o.product_names.join("; ") : ""),
      csvEscape(Array.isArray(o.skus) ? o.skus.join("; ") : ""),
      csvEscape(o.total_quantity || ""),
      csvEscape(o.gross_sales),
      csvEscape(o.commission),
      csvEscape(o.logistics),
      csvEscape(o.returns),
      csvEscape(o.partner_services),
      csvEscape(o.promotion),
      csvEscape(o.other_services),
      csvEscape(o.total_charges),
      csvEscape(o.net_amount),
    ]);

    const csvContent = [
      headers.map(csvEscape).join(","),
      ...rows.map((r) => r.join(","))
    ].join("\r\n");

    const blob = new Blob(
      ["\uFEFF" + csvContent],
      { type: "text/csv;charset=utf-8;" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildFilename = (suffix: string) => {
    const accountName = (accounts.find((a: any) => a.id === selectedAccountId)?.name ?? "account")
      .replace(/[^a-zA-Z0-9\u0400-\u04FF]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `ozon-charges-${accountName}-${fromDate}-to-${toDate}-${suffix}.csv`;
  };

  const handleDownloadSelected = () => {
    const orders = allOrders.filter((o: any) => selectedOrders.has(o.posting_number));
    downloadCSV(orders, buildFilename("selected"));
  };

  const handleDownloadAll = () => {
    downloadCSV(allOrders, buildFilename("all"));
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <CreditCard className="w-7 h-7 text-purple-400" />
            Ozon Order Charges
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Actual financial transaction breakdown per order.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-panel p-4 flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 w-full">
          <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
            Account
          </label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all outline-none"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 w-full">
          <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
            From Date
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full bg-gray-900/50 border border-gray-700 rounded-lg pl-10 pr-3 py-2 text-sm text-white focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all outline-none"
            />
          </div>
        </div>
        <div className="flex-1 w-full">
          <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
            To Date
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full bg-gray-900/50 border border-gray-700 rounded-lg pl-10 pr-3 py-2 text-sm text-white focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all outline-none"
            />
          </div>
        </div>
        <div>
          <button
            onClick={loadCharges}
            disabled={loading || !selectedAccountId}
            className="w-full md:w-auto bg-purple-600 hover:bg-purple-500 text-white font-medium py-2 px-6 rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? "Loading..." : "Load Charges"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
          <div className="text-sm text-red-200">{error}</div>
        </div>
      )}

      {data && (
        <>
          
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-6">
            <div className="glass-panel p-3 flex flex-col justify-center border-t-2 border-blue-500/50">
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1">Total Orders</div>
              <div className="text-lg font-bold text-white">{data.summary.mapped_orders}</div>
            </div>
            <div className="glass-panel p-3 flex flex-col justify-center border-t-2 border-cyan-500/50">
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1">Total Items</div>
              <div className="text-lg font-bold text-white">{data.summary.totalItems || 0}</div>
            </div>
            <div className="glass-panel p-3 flex flex-col justify-center border-t-2 border-emerald-500/50">
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1">Gross Sales</div>
              <div className="text-lg font-bold text-emerald-400">{formatCurrency(data.summary.totalSales)}</div>
            </div>
            <div className="glass-panel p-3 flex flex-col justify-center border-t-2 border-orange-500/50">
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1">Returns</div>
              <div className="text-lg font-bold text-orange-400">{formatCurrency(data.summary.totalReturnsSales || 0)}</div>
            </div>
            <div className="glass-panel p-3 flex flex-col justify-center border-t-2 border-emerald-400/50">
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1">Net Sales</div>
              <div className="text-lg font-bold text-emerald-300">{formatCurrency(data.summary.netSales || 0)}</div>
            </div>
            <div className="glass-panel p-3 flex flex-col justify-center border-t-2 border-red-500/50">
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1" title="Mapped to orders">Total Ozon Deduction</div>
              <div className="text-lg font-bold text-red-400">{formatCurrency(data.summary.totalMappedCharges)}</div>
            </div>
            <div className="glass-panel p-3 flex flex-col justify-center border-t-2 border-green-500/50 bg-green-950/20">
              <div className="text-[10px] text-green-400/80 font-medium uppercase tracking-wider mb-1">Net Seller Amount</div>
              <div className="text-lg font-bold text-green-400">{formatCurrency(data.summary.netAmount)}</div>
            </div>
          </div>


          <div className="text-xs text-gray-500 flex justify-end gap-4">
            <span>Finance Transactions: <strong>{data.summary.total_finance_transactions}</strong></span>
            <span>Mapped Orders: <strong>{data.summary.mapped_orders}</strong></span>
            <span>Unmapped Transactions: <strong>{data.summary.unmapped_transactions}</strong></span>
          </div>

          {/* Orders Table - SALES REPORT */}
          <div className="glass-panel overflow-hidden mb-6">
            {/* Toolbar */}
            <div className="p-3 border-b border-gray-800 bg-gray-900/40 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Box className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">SALES REPORT</h3>
                {selectedOrders.size > 0 && (
                  <span className="text-xs text-purple-300 bg-purple-900/30 border border-purple-700/40 px-2 py-0.5 rounded-full">
                    {selectedOrders.size} order{selectedOrders.size !== 1 ? "s" : ""} selected
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadSelected}
                  disabled={selectedOrders.size === 0}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Download selected orders as CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Selected CSV
                </button>
                <button
                  onClick={handleDownloadAll}
                  disabled={allOrders.length === 0}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-700/80 hover:bg-gray-600 text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Download all loaded orders as CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download All CSV
                </button>
              </div>
            </div>
            <div className="w-full overflow-x-auto pb-2">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-gray-900/60 text-[10px] text-gray-400 uppercase tracking-wider">
                  <tr>
                    {/* Select All checkbox */}
                    <th className="px-2 py-2 w-6">
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 rounded accent-purple-500 cursor-pointer"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleSelectAll}
                        title="Select / deselect all"
                      />
                    </th>
                    <th className="px-2 py-2 font-medium">Order Date</th>
                    <th className="px-2 py-2 font-medium">Order Number</th>
                    <th className="px-2 py-2 font-medium">Posting Number</th>
                    <th className="px-2 py-2 font-medium">Product</th>
                    <th className="px-2 py-2 font-medium">SKU</th>
                    <th className="px-2 py-2 font-medium text-center">Qty</th>
                    <th className="px-2 py-2 font-medium text-right text-emerald-400">Order Value</th>
                    <th className="px-2 py-2 font-medium text-right text-red-400/70">Commission</th>
                    <th className="px-2 py-2 font-medium text-right text-red-400/70">Logistics</th>
                    <th className="px-2 py-2 font-medium text-right text-red-400/70">Returns</th>
                    <th className="px-2 py-2 font-medium text-right text-red-400/70">Partner Services</th>
                    <th className="px-2 py-2 font-medium text-right text-red-400/70">Promotion</th>
                    <th className="px-2 py-2 font-medium text-right text-red-400/70">Other</th>
                    <th className="px-2 py-2 font-medium text-right text-red-400">Total Ozon Deduction</th>
                    <th className="px-2 py-2 font-medium text-right text-emerald-400">Net Seller Amount</th>
                    <th className="px-1 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {data.orders.map((order: any) => {
                    const isExpanded = expandedOrders[order.posting_number];
                    return (
                      <React.Fragment key={order.posting_number} >
                        <tr 
                     className={`transition-colors cursor-pointer group ${
                            selectedOrders.has(order.posting_number) ? "bg-purple-900/10" : ""
                          } ${
                            order.fbs_order_status === "cancelled" ? "opacity-70 bg-red-950/10 hover:bg-red-900/10" : "hover:bg-gray-800/30"
                          }`}
                          onClick={() => toggleOrder(order.posting_number)}
                        >
                          {/* Checkbox cell — stop propagation so clicking the checkbox doesn't expand the row */}
                          <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 rounded accent-purple-500 cursor-pointer"
                              checked={selectedOrders.has(order.posting_number)}
                              onChange={() => toggleSelectOrder(order.posting_number)}
                            />
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-gray-400 text-xs">{order.order_date || '—'}</td>
                          <td className="px-2 py-2">
                            <div className="font-medium text-gray-200 text-xs flex items-center gap-1">
                              {order.order_number}
                              {order.fbs_order_status === "cancelled" && (
                                <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-red-900/60 text-red-400 border border-red-800/50 leading-none" title="This order was cancelled by the seller or buyer in Ozon">CANCELLED</span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="text-[10px] text-gray-500 font-mono">{order.posting_number}</div>
                          </td>
                          <td className="px-2 py-2 max-w-[130px]">
                            <div className="text-gray-300 truncate text-xs" title={order.product_names.join(", ")}>
                              {order.product_names.join(", ") || <span className="text-gray-600 italic">No name</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="text-[10px] text-gray-500 truncate max-w-[100px]" title={order.skus.join(", ")}>
                              {order.skus.length > 1 ? `${order.skus.length} SKUs` : order.skus[0] || "Unknown SKU"}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center text-gray-300 font-medium">
                            {order.total_quantity || 1}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <div className={`font-medium text-xs ${
                              order.gross_sales === 0 ? "text-gray-500" : "text-emerald-400"
                            }`}>
                              {formatCurrency(order.gross_sales)}
                              {order.gross_sales === 0 && order.fbs_order_status === "cancelled" && (
                                <div className="text-[9px] text-gray-600 mt-0.5">Non-RUB / cancelled</div>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right text-red-400/80">{formatCurrency(order.commission)}</td>
                          <td className="px-2 py-2 text-right text-red-400/80">{formatCurrency(order.logistics)}</td>
                          <td className="px-2 py-2 text-right text-red-400/80">{formatCurrency(order.returns)}</td>
                          <td className="px-2 py-2 text-right text-red-400/80">{formatCurrency(order.partner_services)}</td>
                          <td className="px-2 py-2 text-right text-red-400/80">{formatCurrency(order.promotion)}</td>
                          <td className="px-2 py-2 text-right text-red-400/80">{formatCurrency(order.other_services)}</td>
                          <td className="px-2 py-2 text-right font-medium text-red-400">{formatCurrency(order.total_charges)}</td>
                          <td className="px-2 py-2 text-right font-bold text-emerald-400">{formatCurrency(order.net_amount)}</td>
                          <td className="px-1 py-2 text-right">
                            {isExpanded ? (
                              <ChevronUp className="w-3 h-3 text-gray-500 group-hover:text-white" />
                            ) : (
                              <ChevronDown className="w-3 h-3 text-gray-500 group-hover:text-white" />
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={16} className="p-0 border-b-0">
                              <div className="bg-black/40 px-6 py-5 shadow-inner border-y border-gray-800 space-y-5">

                                {/* ── Section 1: ORDER INFORMATION ── */}
                                <div>
                                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 border-b border-gray-800 pb-2">Order Information</h4>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-3 text-xs">
                                    <div>
                                      <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-0.5">Order Number</div>
                                      <div className="text-gray-200 font-mono">{order.order_number}</div>
                                    </div>
                                    <div>
                                      <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-0.5">Posting Number</div>
                                      <div className="text-gray-200 font-mono">{order.posting_number}</div>
                                    </div>
                                    <div>
                                      <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-0.5">Order Date</div>
                                      <div className="text-gray-300">{order.order_date || '—'}</div>
                                    </div>
                                    <div>
                                      <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-0.5">SKU(s)</div>
                                      <div className="text-gray-300">{order.skus.join(', ') || '—'}</div>
                                    </div>
                                    <div className="md:col-span-2">
                                      <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-0.5">Product</div>
                                      <div className="text-gray-300">{order.product_names.join(', ') || '—'}</div>
                                    </div>
                                    <div>
                                      <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-0.5">Order Value</div>
                                      <div className="text-emerald-400 font-semibold">
                                        {formatCurrency(order.gross_sales)}
                                        {order.sales_source === 'order_api' && (
                                          <span className="text-yellow-500/70 text-[10px] ml-1" title="Price from FBS order API (trailing charge month)">*(trailing)*</span>
                                        )}
                                        {order.sales_source === 'customer_price_rub' && (
                                          <span className="text-yellow-500/70 text-[10px] ml-1" title="Customer paid price in RUB from FBS financial_data — used because seller lists in non-RUB currency (trailing month)">*(trailing/RUB)*</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* ── Section 2: CHARGE BREAKDOWN ── */}
                                <div>
                                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 border-b border-gray-800 pb-2">Charge Breakdown</h4>
                                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                    {[
                                      { label: 'Ozon Referral Fee', value: order.commission, color: 'text-red-400/80' },
                                      { label: 'Delivery Services', value: order.logistics, color: 'text-red-400/80' },
                                      { label: 'Returns / Sales Reversal', value: order.returns, color: 'text-orange-400/80' },
                                      { label: 'Partner Services', value: order.partner_services, color: 'text-red-400/80' },
                                      { label: 'Promotion', value: order.promotion, color: 'text-purple-400/80' },
                                      { label: 'Other', value: order.other_services, color: 'text-gray-400' },
                                      { label: 'Total Ozon Deduction', value: order.total_charges, color: 'text-red-400 font-bold' },
                                      { label: 'Net Amount After Ozon', value: order.net_amount, color: 'text-emerald-400 font-bold text-base' },
                                    ]
                                      .filter((item) => item.value !== 0 || item.label === 'Total Ozon Deduction' || item.label === 'Net Amount After Ozon')
                                      .map(({ label, value, color }) => (
                                      <div key={label}>
                                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
                                        <div className={`text-sm ${color}`}>{formatCurrency(value)}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* ── Section 3: RETURN / REFUND INFORMATION ── */}
                                <div>
                                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 border-b border-gray-800 pb-2">Return / Refund Information</h4>
                                  {order.return_info?.has_return ? (
                                    <div className="space-y-3">
                                      {/* Summary badge */}
                                      <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300">
                                        <span>⚠ Returned</span>
                                        <span className="text-orange-400/60">|</span>
                                        <span>Total Refund: {formatCurrency(order.return_info.total_refund_amount)}</span>
                                        {order.return_info.return_logistics_charge !== 0 && (
                                          <><span className="text-orange-400/60">|</span>
                                          <span>Return Logistics: {formatCurrency(order.return_info.return_logistics_charge)}</span></>
                                        )}
                                      </div>
                                      {/* Per-return-transaction detail */}
                                      {order.return_info.transactions.map((rt: any, ri: number) => (
                                        <div key={`ret-${ri}`} className="rounded-lg border border-orange-900/30 bg-orange-950/20 p-3 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                                          <div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Return Status</div>
                                            <div className="text-orange-300 font-semibold">{rt.operation_type === 'ClientReturnAgentOperation' ? 'Client Return' : 'Order Storno'}</div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Return / Refund Date</div>
                                            <div className="text-gray-300">{rt.date || '—'}</div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Returned Quantity</div>
                                            <div className="text-gray-300">{rt.returned_quantity > 0 ? rt.returned_quantity : '—'}</div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Refund Amount</div>
                                            <div className="text-red-400 font-semibold">{formatCurrency(rt.refund_amount)}</div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Return Posting Number</div>
                                            <div className="text-gray-300 font-mono text-[10px]">{rt.posting_number || '—'}</div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Return Order ID</div>
                                            <div className="text-gray-300 font-mono text-[10px]">{rt.order_id || '—'}</div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Finance Operation ID</div>
                                            <div className="text-gray-300 font-mono text-[10px]">{rt.operation_id}</div>
                                          </div>
                                          <div>
                                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Return Logistics Charge</div>
                                            <div className={order.return_info.return_logistics_charge !== 0 ? 'text-red-400' : 'text-gray-500'}>
                                              {order.return_info.return_logistics_charge !== 0
                                                ? formatCurrency(order.return_info.return_logistics_charge)
                                                : '—'}
                                            </div>
                                          </div>
                                          {rt.items?.length > 0 && (
                                            <div className="col-span-2 md:col-span-4">
                                              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Returned Items</div>
                                              <div className="text-gray-300 text-[10px]">
                                                {rt.items.map((item: any, ii: number) => (
                                                  <span key={ii}>{item.name || item.sku}{item.quantity ? ` ×${item.quantity}` : ''}{ii < rt.items.length - 1 ? '; ' : ''}</span>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-gray-500 italic">Return Status: No return</div>
                                  )}
                                </div>

                                {/* ── Section 4: RAW FINANCE TRANSACTIONS ── */}
                                <div>
                                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 border-b border-gray-800 pb-2">Raw Finance Transactions</h4>
                                  <div className="overflow-x-auto rounded-lg border border-gray-800/60 bg-gray-900/50">
                                    <table className="w-full text-left text-xs whitespace-nowrap">
                                      <thead className="bg-gray-800/30 text-gray-500">
                                        <tr>
                                          <th className="px-3 py-2 font-medium">Date</th>
                                          <th className="px-3 py-2 font-medium">Op ID</th>
                                          <th className="px-3 py-2 font-medium">Posting / Order</th>
                                          <th className="px-3 py-2 font-medium">Type ID / Name</th>
                                          <th className="px-3 py-2 font-medium">Ozon UI Category</th>
                                          <th className="px-3 py-2 font-medium">Internal Category</th>
                                          <th className="px-3 py-2 font-medium">Mapping Source</th>
                                          <th className="px-3 py-2 font-medium text-right">Amount</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-800/40">
                                        {order.transactions.map((tx: any, idx: number) => (
                                          <tr key={`${tx.operation_id}-${idx}`} className="hover:bg-gray-800/50">
                                            <td className="px-3 py-2 text-gray-400">{tx.operation_date}</td>
                                            <td className="px-3 py-2 text-gray-400 font-mono">{tx.operation_id}</td>
                                            <td className="px-3 py-2 text-gray-400 font-mono text-[10px]">
                                              {tx.posting_number || '—'}<br/>
                                              <span className="text-gray-500">{tx.order_id || ''}</span>
                                            </td>
                                            <td className="px-3 py-2 text-gray-300 text-[10px]">
                                              {tx.type_id ? `[${tx.type_id}] ` : ''}{tx.operation_type}<br/>
                                              <span className="text-gray-500 max-w-[160px] truncate block" title={tx.operation_type_name}>{tx.operation_type_name}</span>
                                            </td>
                                            <td className="px-3 py-2 text-gray-300 text-[10px]">
                                              <span className="px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300 border border-purple-800/30">{tx.ozon_ui_category || '—'}</span>
                                            </td>
                                            <td className="px-3 py-2 text-[10px]">
                                              <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{tx.charge_category}</span>
                                            </td>
                                            <td className="px-3 py-2 text-[10px] text-gray-400">
                                              {tx.mapping_source || '—'}
                                            </td>
                                            <td className="px-3 py-2 text-right font-medium text-gray-200">{formatCurrency(tx.amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  
                  {data.orders.length === 0 && (
                    <tr>
                      <td colSpan={16} className="px-4 py-8 text-center text-gray-500 text-sm">
                        No orders found in this period.
                      </td>
                    </tr>
                  )}

                  {/* ── TOTAL row ── */}
                  {data.orders.length > 0 && (() => {
                    const T = data.orders.reduce(
                      (acc: any, o: any) => ({
                        gross_sales:      acc.gross_sales      + (o.gross_sales      || 0),
                        net_sales:        acc.net_sales        + (o.net_sales        || 0),
                        commission:       acc.commission       + (o.commission       || 0),
                        logistics:        acc.logistics        + (o.logistics        || 0),
                        returns:          acc.returns          + (o.returns          || 0),
                        partner_services: acc.partner_services + (o.partner_services || 0),
                        promotion:        acc.promotion        + (o.promotion        || 0),
                        other_services:   acc.other_services   + (o.other_services   || 0),
                        total_charges:    acc.total_charges    + (o.total_charges    || 0),
                        net_amount:       acc.net_amount       + (o.net_amount       || 0),
                      }),
                      { gross_sales:0, net_sales:0, commission:0, logistics:0, returns:0,
                        partner_services:0, promotion:0, other_services:0, total_charges:0, net_amount:0 }
                    );
                    return (
                      <tr className="border-t-2 border-purple-500/50 bg-gray-900/70">
                        {/* no checkbox for total row */}
                        <td className="px-2 py-2" />
                        <td className="px-2 py-2">
                          <div className="font-bold text-purple-300 uppercase tracking-widest text-xs">Total</div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="text-[10px] text-gray-500">{data.orders.length} orders</div>
                        </td>
                        <td colSpan={2} className="px-2 py-2">
                          <span className="text-[10px] text-gray-500 italic">—</span>
                        </td>
                        <td className="px-2 py-2 text-center text-gray-400 font-medium">
                          {data.summary.totalItems || 0}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="font-bold text-emerald-400 text-xs">{formatCurrency(T.gross_sales)}</div>
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-red-400/80 text-xs">{formatCurrency(T.commission)}</td>
                        <td className="px-2 py-2 text-right font-bold text-red-400/80 text-xs">{formatCurrency(T.logistics)}</td>
                        <td className="px-2 py-2 text-right font-bold text-red-400/80 text-xs">{formatCurrency(T.returns)}</td>
                        <td className="px-2 py-2 text-right font-bold text-red-400/80 text-xs">{formatCurrency(T.partner_services)}</td>
                        <td className="px-2 py-2 text-right font-bold text-red-400/80 text-xs">{formatCurrency(T.promotion)}</td>
                        <td className="px-2 py-2 text-right font-bold text-red-400/80 text-xs">{formatCurrency(T.other_services)}</td>
                        <td className="px-2 py-2 text-right font-bold text-red-400 text-xs">{formatCurrency(T.total_charges)}</td>
                        <td className="px-2 py-2 text-right font-bold text-emerald-400 text-xs">{formatCurrency(T.net_amount)}</td>
                        <td className="px-1 py-2" />
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Unmapped Charges */}
          {data.unmapped.length > 0 && (
            <div className="glass-panel overflow-hidden mt-6 border-yellow-900/30">
              <div className="p-4 border-b border-gray-800 bg-yellow-900/10 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <h3 className="font-semibold text-yellow-500">Unmapped / Seller-Level Charges</h3>
              </div>
              <div className="p-4 bg-gray-900/30">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Summary Grouped By Category</h4>
                <div className="overflow-x-auto mb-6">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-900/60 text-xs text-gray-400 uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {(() => {
                        const summaryMap = new Map();
                        data.unmapped.forEach((tx: any) => {
                          const key = `${tx.ozon_ui_category}|${tx.type_id}|${tx.operation_type_name}`;
                          if (!summaryMap.has(key)) {
                            summaryMap.set(key, { cat: tx.ozon_ui_category, typeId: tx.type_id, name: tx.operation_type_name, amount: 0 });
                          }
                          summaryMap.get(key).amount += tx.amount;
                        });
                        const summaries = Array.from(summaryMap.values());
                        return summaries.map((s, i) => (
                          <tr key={`sum-${i}`} className="hover:bg-gray-800/30">
                            <td className="px-4 py-3 text-gray-300">{s.cat || '—'}</td>
                            <td className="px-4 py-3 text-gray-300">
                              {s.typeId ? `[${s.typeId}] ` : ''}{s.name}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-yellow-400/90">{formatCurrency(s.amount)}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>

                <details className="group">
                  <summary className="text-xs font-bold text-gray-400 uppercase tracking-widest cursor-pointer select-none flex items-center gap-1.5 hover:text-gray-300 transition-colors">
                    <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" />
                    Unmapped Detail View
                  </summary>
                  <div className="overflow-x-auto mt-4 border border-gray-800/60 rounded-lg">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead className="bg-gray-900/60 text-gray-400 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3 font-medium">Date / Accrual ID</th>
                          <th className="px-4 py-3 font-medium">Type</th>
                          <th className="px-4 py-3 font-medium">Ozon UI Category</th>
                          <th className="px-4 py-3 font-medium text-right">Amount</th>
                          <th className="px-4 py-3 font-medium">References</th>
                          <th className="px-4 py-3 font-medium">Reason Not Mapped</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {data.unmapped.map((tx: any, idx: number) => (
                          <tr key={`unmapped-${tx.operation_id}-${idx}`} className="hover:bg-gray-800/30">
                            <td className="px-4 py-3 text-gray-400">
                              <div>{tx.operation_date}</div>
                              <div className="font-mono text-[10px] text-gray-500 mt-0.5" title="Operation ID">{tx.operation_id}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-300">
                              <div>{tx.type_id ? `[${tx.type_id}] ` : ''}{tx.operation_type}</div>
                              <div className="text-[10px] text-gray-500 mt-0.5">{tx.operation_type_name}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-300">
                              <span className="px-2 py-1 rounded bg-purple-900/30 text-purple-300 border border-purple-800/30 text-[10px]">{tx.ozon_ui_category || '—'}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-yellow-400/90">
                              {formatCurrency(tx.amount)}
                            </td>
                            <td className="px-4 py-3 text-[10px] text-gray-500 font-mono">
                              <div>{tx.posting_number ? `Posting: ${tx.posting_number}` : ''}</div>
                              <div>{tx.order_id ? `Order: ${tx.order_id}` : ''}</div>
                              <div>{(tx.sku && tx.sku.length > 0) ? `SKU: ${tx.sku.join(', ')}` : ''}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs max-w-xs whitespace-normal">
                              {tx.reason}
                              <div className="text-[10px] text-gray-500 mt-1">Source: {tx.mapping_source}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </div>
          )}

          {/* Ozon Charge Summary (Compact) */}
          <div className="glass-panel overflow-hidden mt-6 border-purple-500/30">
            <div className="p-4 border-b border-gray-800 bg-gray-900/40">
              <h3 className="font-semibold text-white">OZON CHARGE SUMMARY</h3>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="text-xs text-gray-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-2 font-medium">Category</th>
                    <th className="py-2 font-medium text-right">Mapped</th>
                    <th className="py-2 font-medium text-right">Unmapped</th>
                    <th className="py-2 font-medium text-right">Total Ozon Charges</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {data.reconciliation && Object.entries(data.reconciliation).map(([cat, vals]: [string, any]) => (
                    <tr key={`charge-sum-${cat}`}>
                      <td className="py-2 text-gray-300">{cat}</td>
                      <td className="py-2 text-right text-gray-400">{formatCurrency(vals.mapped)}</td>
                      <td className="py-2 text-right text-gray-400">{formatCurrency(vals.unmapped)}</td>
                      <td className="py-2 text-right font-medium text-red-400">{formatCurrency(vals.api_total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-700">
                    <td className="py-2 font-bold text-gray-300">Total</td>
                    <td className="py-2 text-right font-bold text-gray-400">{formatCurrency(data.summary.totalMappedCharges)}</td>
                    <td className="py-2 text-right font-bold text-gray-400">{formatCurrency(data.summary.totalUnmappedCharges)}</td>
                    <td className="py-2 text-right font-bold text-red-400">{formatCurrency(data.summary.totalOzonCharges)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Ozon UI Category Reconciliation Table */}
          {data.reconciliation && (
            <div className="glass-panel overflow-hidden mt-6 border-purple-500/30">
              <div className="p-4 border-b border-gray-800 bg-purple-900/10 flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-purple-400" />
                <h3 className="font-semibold text-white">OZON UI REFERENCE / RECONCILIATION</h3>
                <span className="text-xs text-gray-400 ml-auto flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-yellow-500/70" />
                  Manual inputs are for reference only and do not alter API calculations.
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-900/60 text-xs text-gray-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium text-right w-48">Ozon UI Total (RUB)</th>
                      <th className="px-4 py-3 font-medium text-right">Our API Total</th>
                      <th className="px-4 py-3 font-medium text-right">Difference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {Object.entries(data.reconciliation).map(([cat, vals]: [string, any]) => {
                      const uiVal = ozonUiTotals[cat] || 0;
                      const diff = vals.api_total - uiVal;
                      return (
                        <tr key={`rec-${cat}`} className="hover:bg-gray-800/30">
                          <td className="px-4 py-3 font-medium text-gray-300">{cat}</td>
                          <td className="px-4 py-3 text-right">
                            <input
                              type="number"
                              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white text-right focus:border-purple-500 outline-none"
                              placeholder="0"
                              value={ozonUiTotals[cat] === undefined ? "" : ozonUiTotals[cat]}
                              onChange={(e) => {
                                const v = e.target.value ? parseFloat(e.target.value) : 0;
                                setOzonUiTotals(prev => ({ ...prev, [cat]: v }));
                              }}
                            />
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-blue-400">{formatCurrency(vals.api_total)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${Math.abs(diff) > 0.01 ? "text-red-400" : "text-emerald-400"}`}>
                            {formatCurrency(diff)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
