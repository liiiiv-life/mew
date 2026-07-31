# Optional container build — see the Docker section of README.md.
# The native install (`./mew setup`) is the primary path; this is for servers and VPSes.
# Two stages: node-pty has no Linux prebuilt and needs a C++ toolchain, the runtime does not.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Manifests first so `npm ci` stays cached until dependencies actually change.
# packages/* are npm workspaces — their package.json must exist before `npm ci`.
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# tmux and git are features, not conveniences: the terminal panel and the commit button shell out to them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tmux git less ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# Not cosmetic: without a UTF-8 locale tmux treats the tab separator in `list-sessions -F`
# as unprintable and rewrites it to "_", which turns the session list into one mangled name.
ENV LANG=C.UTF-8 \
    NODE_ENV=production \
    MEW_WORKSPACE=/workspace \
    MEW_DATA_DIR=/data \
    MEW_TEAM_PORT=5000 \
    HOME=/home/mew

WORKDIR /app
COPY --from=build /app /app
COPY docker-entrypoint.sh /usr/local/bin/mew-entrypoint

# The container runs as the host user's uid (compose `user:`), which has no /etc/passwd entry,
# so HOME must be writable by anyone — git config and the tmux socket live there.
RUN mkdir -p /workspace /data /home/mew \
 && chmod 1777 /home/mew \
 && chmod +x /usr/local/bin/mew-entrypoint

EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/auth/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps the tmux/pty children the terminal panel spawns.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/mew-entrypoint"]
CMD ["node", "server/serve.ts"]
