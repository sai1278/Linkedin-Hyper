FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Install real Google Chrome Stable (NOT Chromium — LinkedIn detects it)
RUN apt-get update && apt-get install -y wget gnupg \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
     >> /etc/apt/sources.list.d/google.list \
  && apt-get update && apt-get install -y google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

# Xvfb for virtual display (headed mode without a real screen)
RUN apt-get update && apt-get install -y xvfb x11-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

COPY src/ ./src/

EXPOSE 3001

ENTRYPOINT ["./entrypoint.sh"]
