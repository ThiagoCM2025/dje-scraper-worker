FROM mcr.microsoft.com/playwright:v1.55.1-noble

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

CMD ["npm", "start"]
