FROM node:24-slim AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .

ENV DOMAIN=robot.villas
RUN yarn build

FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY drizzle/ drizzle/
COPY feeds.yml ./

EXPOSE 8080

CMD ["node", "server.js"]
