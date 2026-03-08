FROM ubuntu:22.04

WORKDIR /app

# Prevent interactive prompts during apt
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 22.x
RUN apt-get update && apt-get install -y curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome Stable — the only browser this project uses
RUN apt-get update && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
    >> /etc/apt/sources.list.d/google.list \
    && apt-get update && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome system dependencies
RUN apt-get update && apt-get install -y \
    libgconf-2-4 libxss1 libglib2.0-0 libnss3 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libx11-6 libx11-xcb1 libxcb1 \
    && rm -rf /var/lib/apt/lists/*

# Install Xvfb for virtual display
RUN apt-get update && apt-get install -y xvfb x11-utils \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user to match pwuser convention
RUN groupadd -r pwuser && useradd -r -g pwuser -m pwuser

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

USER pwuser
ENTRYPOINT ["./entrypoint.sh"]
