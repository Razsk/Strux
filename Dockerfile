FROM node:24-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/app/data/strux.db

EXPOSE 3001

CMD ["npm", "start"]
