FROM mcr.microsoft.com/playwright:v1.55.1-jammy

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev

COPY . .

CMD ["node", "src/index.js"]
