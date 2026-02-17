FROM node:20-bookworm

# Install build tools for native modules (better-sqlite3, node-pty)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install backend dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Install web dependencies
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

# Copy all source
COPY . .

# Build backend (TypeScript -> dist/)
RUN npm run build

# Build Next.js web app
RUN cd web && npm run build

# Create data directory for SQLite
RUN mkdir -p /app/data

# Next.js runs on port 3000
EXPOSE 3000

# Start the Next.js web app (which also triggers the orchestrator via API routes)
WORKDIR /app/web
CMD ["npm", "run", "start"]
