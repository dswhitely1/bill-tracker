# syntax=docker/dockerfile:1

# Built from the workspace root, not from apps/web — the Nx graph, the root
# lockfile, and libs/shared-types all have to be in context.
#
#   docker build -f apps/web/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /workspace

# .npmrc carries `legacy-peer-deps=true`, without which this install fails
# ERESOLVE — see the note in apps/api/Dockerfile. It holds no credentials.
COPY package.json package-lock.json .npmrc ./

# Workspace manifests before the install — it is what symlinks
# node_modules/@bill-tracker/shared-types into libs/. See the longer note in
# apps/api/Dockerfile. Manifests only, so source edits keep the cached layer.
COPY libs/shared-types/package.json ./libs/shared-types/
COPY apps/api/package.json ./apps/api/
COPY apps/web-e2e/package.json ./apps/web-e2e/

RUN npm ci

COPY . .

# Nothing environment-specific is baked in here. The client talks to the
# relative path '/api', which nginx proxies, so one image works against any
# API host — there is no build argument to get wrong.
RUN npx nx build web

FROM nginx:1.27-alpine AS runtime

# @angular/build:application splits its output: browser assets under
# `browser/`, licence text beside it. Only `browser/` is servable.
COPY --from=build /workspace/dist/apps/web/browser /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# 8080 rather than 80 so the server can run unprivileged. nginx:alpine ships
# an `nginx` user, and the stock config's `listen 80` is replaced above.
EXPOSE 8080
