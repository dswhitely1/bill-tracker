# syntax=docker/dockerfile:1

# Built from the workspace root, not from apps/api — the Nx graph, the root
# lockfile, and libs/shared-types all have to be in context.
#
#   docker build -f apps/api/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /workspace

# Lockfile first so the dependency layer survives source edits.
#
# .npmrc comes along because it carries `legacy-peer-deps=true`, without
# which this install fails ERESOLVE — @nx/nest@23.2.0 peer-requires
# @nestjs/common <12.0.0 and this project runs 12.1.2. It holds no
# credentials; check that before copying an .npmrc into any image, since a
# registry token in one is readable by anyone who can pull the result.
COPY package.json package-lock.json .npmrc ./

# The workspace manifests have to exist before `npm ci`, not after. This is an
# npm-workspaces repo (`workspaces: ["apps/*", "libs/*"]`), and the install is
# what creates node_modules/@bill-tracker/shared-types as a symlink into
# libs/. Install first and the symlink is never made, so webpack fails with
# `Can't resolve '@bill-tracker/shared-types'` — a module-resolution error
# that looks nothing like the ordering problem it is.
#
# Only the manifests, so editing source does not invalidate the install layer.
COPY libs/shared-types/package.json ./libs/shared-types/
COPY apps/api/package.json ./apps/api/
COPY apps/web-e2e/package.json ./apps/web-e2e/

RUN npm ci

COPY . .

# `prune` runs build, then derives a production manifest and lockfile from
# apps/api/package.json's dependencies and copies any workspace libraries the
# bundle needs. That manifest is only correct because apps/api/package.json
# declares every module the webpack bundle externalizes — webpack leaves all
# 20 of them as bare `require()` calls, so a manifest that under-declares
# them produces an image that boots and immediately dies on the first
# missing module.
RUN npx nx prune api && npx nx build-migrate api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# bcrypt ships prebuilt binaries for musl, but node-gyp needs these if it
# ever has to fall back to compiling.
RUN apk add --no-cache libstdc++

COPY --from=build /workspace/apps/api/dist/package.json \
                  /workspace/apps/api/dist/package-lock.json ./
COPY --from=build /workspace/apps/api/dist/workspace_modules ./workspace_modules
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /workspace/apps/api/dist/main.js ./main.js
# The migration runner's own bundle. It is in this image rather than one of
# its own so both share a single dependency install; the `migrate` compose
# service overrides the command to run it.
COPY --from=build /workspace/apps/api/dist-migrate/main.js ./migrate.js

# Drop root. node:alpine ships a `node` user; the app writes nothing to disk.
USER node

EXPOSE 3000
CMD ["node", "main.js"]
