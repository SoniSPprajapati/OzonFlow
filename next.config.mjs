import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "puppeteer", "exceljs", "pdf-lib", "pino"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
