"use client";

import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Power, Key, UserCheck, Shield } from "lucide-react";

interface Account {
  id: string;
  name: string;
  clientId: string;
  apiKey: string;
  isEnabled: boolean;
  createdAt: string;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      setAccounts(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingAccount(null);
    setName("");
    setClientId("");
    setApiKey("");
    setIsEnabled(true);
    setError("");
    setIsModalOpen(true);
  };

  const openEditModal = (account: Account) => {
    setEditingAccount(account);
    setName(account.name);
    setClientId(account.clientId);
    setApiKey(account.apiKey);
    setIsEnabled(account.isEnabled);
    setError("");
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || !clientId.trim() || !apiKey.trim()) {
      setError("Account Name, Client ID, and API Key are required.");
      return;
    }

    try {
      const res = editingAccount
        ? await fetch(`/api/accounts/${editingAccount.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, clientId, apiKey, isEnabled }),
          })
        : await fetch("/api/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, clientId, apiKey, isEnabled }),
          });

      if (!res.ok) {
        let errMsg = `Request failed with status ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) errMsg = data.error;
        } catch {
          const text = await res.text().catch(() => "");
          if (text) errMsg = text;
        }
        throw new Error(errMsg);
      }

      setIsModalOpen(false);
      fetchAccounts();
    } catch (err: any) {
      setError(err.message || "Failed to save account");
    }
  };

  const handleToggleEnable = async (account: Account) => {
    try {
      await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !account.isEnabled }),
      });
      fetchAccounts();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this account?")) return;
    try {
      await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      fetchAccounts();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Seller Accounts</h2>
          <p className="text-sm text-gray-400 mt-1">
            Manage Ozon Seller API credentials stored in SQLite via Prisma.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center space-x-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold px-4.5 py-2.5 rounded-xl shadow-lg shadow-purple-900/30 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Add Account</span>
        </button>
      </div>

      {/* Accounts Cards List */}
      {loading ? (
        <div className="glass-card py-12 text-center text-gray-500 text-xs rounded-2xl">
          Loading seller accounts...
        </div>
      ) : accounts.length === 0 ? (
        <div className="glass-card py-12 text-center text-gray-500 text-xs rounded-2xl">
          No seller accounts configured yet. Click "Add Account" to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className={`glass-card p-6 rounded-2xl border transition flex flex-col justify-between space-y-5 bg-[#111827]/40 ${
                acc.isEnabled
                  ? "border-gray-800 hover:border-purple-500/50"
                  : "border-gray-900 opacity-60"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="font-bold text-base text-white tracking-tight truncate">{acc.name}</span>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] font-semibold ${
                      acc.isEnabled
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        : "bg-gray-800 text-gray-400 border border-gray-700"
                    }`}
                  >
                    {acc.isEnabled ? "Active" : "Disabled"}
                  </span>
                </div>

                <div className="space-y-2 text-xs text-gray-400 font-mono bg-gray-950 p-3.5 rounded-xl border border-gray-900">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Client ID:</span>
                    <span className="text-gray-200 font-semibold">{acc.clientId}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">API Key:</span>
                    <span className="text-gray-200">
                      {acc.apiKey.substring(0, 8)}••••••••
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-800/60">
                <button
                  onClick={() => handleToggleEnable(acc)}
                  className={`flex items-center space-x-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
                    acc.isEnabled
                      ? "text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20"
                      : "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{acc.isEnabled ? "Disable" : "Enable"}</span>
                </button>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => openEditModal(acc)}
                    className="p-2 text-gray-400 hover:text-purple-300 hover:bg-purple-500/10 rounded-lg transition"
                    title="Edit Account"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(acc.id)}
                    className="p-2 text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                    title="Delete Account"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="glass-card max-w-md w-full p-6 border border-gray-700 shadow-2xl rounded-2xl bg-[#111827]">
            <h3 className="text-lg font-bold text-white mb-4 tracking-tight">
              {editingAccount ? "Edit Seller Account" : "Add New Seller Account"}
            </h3>

            {error && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-xl">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Account Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Frostrek LLP"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 text-gray-100 text-sm rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Client ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. 3200337"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 text-gray-100 text-sm rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-purple-500 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  placeholder="UUID API Key from Ozon Seller portal"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 text-gray-100 text-sm rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-purple-500 focus:outline-none font-mono"
                />
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="enableCheck"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-950 border-gray-700 text-purple-600 focus:ring-purple-500"
                />
                <label htmlFor="enableCheck" className="text-xs text-gray-300">
                  Enable account for automated execution
                </label>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-4.5 py-2 rounded-xl transition shadow-md shadow-purple-900/40"
                >
                  {editingAccount ? "Save Changes" : "Create Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
