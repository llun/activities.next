FROM node:24-alpine AS base
ARG UID="1001"
ARG GID="1001"
ARG ACTIVITIES_HOST="localhost"
ARG ACTIVITIES_DATABASE_TYPE="knex"
ARG ACTIVITIES_DATABASE_CLIENT="better-sqlite3"
ARG ACTIVITIES_DATABASE_SQLITE_FILENAME="/opt/activities.next/data.sqlite"
ENV ACTIVITIES_HOST=${ACTIVITIES_HOST}
ENV ACTIVITIES_DATABASE_TYPE=${ACTIVITIES_DATABASE_TYPE}
ENV ACTIVITIES_DATABASE_CLIENT=${ACTIVITIES_DATABASE_CLIENT}
ENV ACTIVITIES_DATABASE_SQLITE_FILENAME=${ACTIVITIES_DATABASE_SQLITE_FILENAME}
# Keep Corepack's download cache outside the project tree. The app user's HOME is
# /opt/activities.next (the project root), so the default COREPACK_HOME of
# $HOME/.cache/node/corepack would place the downloaded yarn.js inside a package
# whose package.json has "type": "module". Node would then load Corepack's
# CommonJS yarn bundle as ESM and fail with `Dynamic require of "util" is not
# supported`. Pointing COREPACK_HOME at a directory with no "type": "module"
# ancestor lets Node load yarn as CommonJS.
ENV COREPACK_HOME="/opt/corepack"
RUN apk add ffmpeg
RUN \
  mkdir -p /opt/activities.next /opt/corepack; \
  addgroup --system --gid "${GID}" app; \
  adduser --system --uid "${UID}" --home /opt/activities.next app; \
  chown app:app /opt/corepack
RUN corepack enable
WORKDIR /opt/activities.next
USER app

FROM base AS build
ADD --chown=app:app . /opt/activities.next/
RUN yarn config set -H enableGlobalCache true
RUN yarn install --immutable
RUN yarn dedupe
RUN ACTIVITIES_SECRET_PHASE=build-placeholder yarn knex migrate:latest --disable-transactions
RUN ACTIVITIES_SECRET_PHASE=build-placeholder BUILD_STANDALONE=true yarn build

FROM base AS output
ENV NODE_ENV="production"
COPY --from=build --chown=app:app /opt/activities.next/.next/standalone /opt/activities.next/
COPY --from=build --chown=app:app /opt/activities.next/public /opt/activities.next/public/
COPY --from=build --chown=app:app /opt/activities.next/.next/static /opt/activities.next/.next/static
COPY --from=build --chown=app:app /opt/activities.next/data.sqlite /opt/activities.next/data.sqlite
RUN rm -rf /opt/activities.next/.yarn
EXPOSE 3000
CMD ["node", "server.js"]
