"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Users, 
  History, 
  Terminal,
  Globe,
  CreditCard
} from "lucide-react";

export function Navbar() {
  const pathname = usePathname();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/accounts", label: "Accounts", icon: Users },
    { href: "/charges", label: "Order Charges", icon: CreditCard },
    { href: "/historical", label: "Historical Reports", icon: History },
    { href: "/logs", label: "Logs", icon: Terminal },
  ];

  return (
    <header className="glass-nav sticky top-0 z-50 px-6 py-3.5 border-b border-gray-800/60 bg-[#0b0f19]/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center text-white font-extrabold text-sm shadow-md shadow-purple-900/30 border border-purple-400/20">
            OZ
          </div>
          <div>
            <h1 className="font-bold text-base text-white tracking-tight leading-none">Ozon Pipeline</h1>
            <div className="flex items-center space-x-1.5 mt-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span className="text-[11px] text-gray-400 font-medium">Europe/Moscow (UTC+3)</span>
            </div>
          </div>
        </div>

        <nav className="flex items-center space-x-1 bg-gray-900/60 p-1 rounded-xl border border-gray-800/80">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-purple-600 text-white shadow-sm shadow-purple-900/50"
                    : "text-gray-400 hover:text-gray-100 hover:bg-gray-800/50"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
