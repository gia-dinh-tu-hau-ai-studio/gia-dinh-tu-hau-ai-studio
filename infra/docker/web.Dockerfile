FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package*.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npm run build --workspace @tu-hau/web

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
CMD ["npm", "run", "start", "--workspace", "@tu-hau/web"]
