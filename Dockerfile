FROM node:22-alpine

WORKDIR /app
COPY build/package.json build/package-lock.json ./
RUN npm ci --omit=dev
COPY build/ ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node

CMD ["node", "server.mjs"]
