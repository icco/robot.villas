FROM node:24-slim AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ src/

RUN yarn build

FROM node:24-slim

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

COPY --from=builder /app/dist/ dist/
COPY feeds.yml ./

EXPOSE 3000

CMD ["node", "dist/index.js"]
