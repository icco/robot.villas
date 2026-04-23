FROM node:25-slim AS builder

WORKDIR /app

COPY package.json yarn.lock .npmrc ./
RUN --mount=type=secret,id=npm_token \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    yarn install --frozen-lockfile && \
    rm -f .npmrc

COPY . .

ENV DOMAIN=robot.villas
RUN yarn build

FROM node:25-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Create a dedicated non-root user, matching the convention used by
# all other Next.js services in this stack.
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs drizzle/ drizzle/
COPY --chown=nextjs:nodejs feeds.yml ./

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
