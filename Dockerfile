FROM oven/bun:1-debian

# Install Chromium system dependencies for PDF generation
RUN apt-get update && apt-get install -y \
    libgbm1 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxss1 \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definitions
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Install Puppeteer bundled Chrome
RUN bunx puppeteer browsers install chrome

# Copy application source code
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

# Generate Prisma Client and build Next.js application
RUN bunx prisma generate
RUN bun run build

EXPOSE 3000

# Push SQLite schema and start Next.js web dashboard
CMD ["sh", "-c", "bunx prisma db push && bunx next start -p 3000"]

