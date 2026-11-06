import "./globals.css";
import { Navbar } from "@/components/Navbar";

export const metadata = {
  title: "Ozon Pipeline Dashboard",
  description: "Automation dashboard for Ozon order processing pipeline",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0b0f19] text-gray-100 antialiased flex flex-col">
        <Navbar />
        <main className="flex-1 max-w-7xl w-full mx-auto p-6">{children}</main>
        <footer className="py-4 text-center text-xs text-gray-500 border-t border-gray-800/40">
          Ozon Automation Dashboard &copy; {new Date().getFullYear()} Frostrek LLP
        </footer>
      </body>
    </html>
  );
}
