FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/
COPY database/ ./database/
COPY scripts/ ./scripts/

USER node
EXPOSE 3100

CMD ["node", "src/index.js"]
