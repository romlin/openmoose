# Build Stage
FROM node:22-slim AS builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy configuration files
COPY package.json pnpm-lock.yaml* tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code and skills
COPY src ./src
COPY skills ./skills

# Build the project
RUN pnpm run build

# --- Runtime Stage ---
FROM node:22-slim

# Install Docker CLI (needed for Sandbox/Browser management)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only production dependencies
COPY --from=builder /app/package.json ./
RUN npm install -g pnpm && pnpm install --prod

# Copy built artifacts and necessary resources
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/skills ./skills
# Re-copy the browser daemon and Dockerfile for runtime builds
COPY src/runtime/browser/daemon.js src/runtime/browser/Dockerfile ./dist/runtime/browser/

# Create a dedicated non-root user.
# NOTE: The user is added to the "docker" group so the gateway can manage
# sandbox / browser containers via the mounted Docker socket. If the socket
# is not mounted this group membership is harmless.
RUN groupadd -r appuser && useradd -r -g appuser -G docker -d /app appuser \
    && chown -R appuser:appuser /app

# Default environment variables
ENV NODE_ENV=production
ENV GATEWAY_PORT=18789
ENV LLM_PROVIDER=node-llama-cpp
ENV LLAMA_CPP_GPU=auto
ENV LLAMA_CPP_MODEL_PATH=/app/models/llama-cpp/ministral-8b-reasoning-q4km.gguf

# Expose the gateway port
EXPOSE 18789

USER appuser

# Run the gateway
CMD ["node", "dist/gateway/server.js"]
