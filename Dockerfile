FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

CMD ["node", "dist/index.js"]
