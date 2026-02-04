# Build stage
FROM cgr.dev/chainguard/node:22-dev AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY server.ts ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM cgr.dev/chainguard/node:22

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY ui/ ./ui/

# Expose port
EXPOSE 3003

# Start the server (env vars passed via docker run -e or --env-file)
CMD ["node", "dist/server.js"]
