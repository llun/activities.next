FROM node:24-alpine AS base
ARG UID="1001"
ARG GID="1001"
ARG ACTIVITIES_HOST="localhost"
ARG ACTIVITIES_DATABASE_TYPE="knex"
ARG ACTIVITIES_DATABASE_CLIENT="pg"
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
ARG WORKSPACES="activities.next @activities/pg @activities/qstash"
ADD --chown=app:app . /opt/activities.next/
RUN yarn config set -H enableGlobalCache true
RUN yarn workspaces focus ${WORKSPACES}
RUN yarn dedupe
RUN if [ "$ACTIVITIES_DATABASE_CLIENT" = "better-sqlite3" ] || [ "$ACTIVITIES_DATABASE_CLIENT" = "sqlite3" ]; then ACTIVITIES_SECRET_PHASE=build-placeholder yarn knex migrate:latest --disable-transactions; else touch /opt/activities.next/data.sqlite; fi
RUN ACTIVITIES_SECRET_PHASE=build-placeholder BUILD_STANDALONE=true yarn build

FROM base AS output
ENV NODE_ENV="production"
COPY --from=build --chown=app:app /opt/activities.next/.next/standalone /opt/activities.next/
COPY --from=build --chown=app:app /opt/activities.next/public /opt/activities.next/public/
COPY --from=build --chown=app:app /opt/activities.next/.next/static /opt/activities.next/.next/static
COPY --from=build --chown=app:app /opt/activities.next/data.sqlite /opt/activities.next/data.sqlite
# The Next.js standalone tracer (@vercel/nft) copies sharp's native *.node
# binary but cannot follow the libvips shared library it dlopen's via native
# RPATH. Since sharp 0.35 the runtime @img/sharp-libvips-* package is no longer
# require()d from JS, so the tracer drops it and libvips-cpp.so.* never reaches
# the image. Without it the instrumentation hook fails to load and every
# request 500s. Re-copy the full sharp install so the .node binary and its
# sibling libvips .so ship together with their original layout intact.
COPY --from=build --chown=app:app /opt/activities.next/node_modules/sharp /opt/activities.next/node_modules/sharp
COPY --from=build --chown=app:app /opt/activities.next/node_modules/@img /opt/activities.next/node_modules/@img
COPY --from=build --chown=app:app /opt/activities.next/node_modules/pg /opt/activities.next/node_modules/pg
COPY --from=build --chown=app:app /opt/activities.next/node_modules/@upstash /opt/activities.next/node_modules/@upstash
COPY --from=build --chown=app:app /opt/activities.next/node_modules/crypto-js /opt/activities.next/node_modules/crypto-js
COPY --from=build --chown=app:app /opt/activities.next/node_modules/jose /opt/activities.next/node_modules/jose
COPY --from=build --chown=app:app /opt/activities.next/node_modules/neverthrow /opt/activities.next/node_modules/neverthrow
RUN rm -rf /opt/activities.next/.yarn
EXPOSE 3000
CMD ["node", "server.js"]
