FROM node:20-slim

# Instala as dependências necessárias para o Chromium / Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libglib2.0-0 \
    --no-install-recommends \
    && rm -rf /var/lib/apt-get/lists/*

# Configura o caminho do Chromium instalado pelo apt
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copia e instala as dependências do Node.js
COPY package*.json ./
RUN npm install

# Copia todo o resto do projeto
COPY . .

# Expõe a porta usada pela aplicação
EXPOSE 8080

CMD ["node", "index.js"]