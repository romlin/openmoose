ARG PW_VERSION=1.58.0
FROM mcr.microsoft.com/playwright:v${PW_VERSION}-noble
WORKDIR /app
ARG PW_VERSION
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm init -y > /dev/null 2>&1 && npm install playwright@${PW_VERSION}
