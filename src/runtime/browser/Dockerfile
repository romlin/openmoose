ARG PW_VERSION=1.58.0
FROM mcr.microsoft.com/playwright:v${PW_VERSION}-noble
WORKDIR /app
ARG PW_VERSION
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm init -y > /dev/null 2>&1 && npm install playwright@${PW_VERSION}
RUN chown -R pwuser:pwuser /app
USER pwuser
COPY daemon.js .
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
