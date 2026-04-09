FROM oven/bun:1.3

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Configure git for test commits
RUN git config --global user.email "test@test.com" && \
    git config --global user.name "test"

WORKDIR /monorepo

# Copy monorepo root files needed for workspace resolution
COPY package.json bun.lock ./
COPY packages/agentic/package.json packages/agentic/
COPY packages/assume/package.json packages/assume/

# Install all workspace deps
RUN bun install

# Copy agentic source and e2e tests
COPY packages/agentic/ packages/agentic/

WORKDIR /monorepo/packages/agentic

# Build the CLI
RUN bun run build

# Run e2e tests
CMD ["bun", "test", "e2e/"]
