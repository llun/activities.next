FROM node:20-alpine as base
ARG UID="1001"
ARG GID="1001"
ARG ACTIVITIES_HOST="localhost"
ARG ACTIVITIES_SECRET_PHASE="this is a secret phase"
ARG ACTIVITIES_DATABASE_TYPE="knex"
ARG ACTIVITIES_DATABASE_CLIENT="better-sqlite3"
ARG ACTIVITIES_DATABASE_SQLITE_FILENAME="/opt/activities.next/data.sqlite"
ENV ACTIVITIES_HOST=${ACTIVITIES_HOST}
ENV ACTIVITIES_SECRET_PHASE=${ACTIVITIES_SECRET_PHASE}
ENV ACTIVITIES_DATABASE_TYPE=${ACTIVITIES_DATABASE_TYPE}
ENV ACTIVITIES_DATABASE_CLIENT=${ACTIVITIES_DATABASE_CLIENT}
ENV ACTIVITIES_DATABASE_SQLITE_FILENAME=${ACTIVITIES_DATABASE_SQLITE_FILENAME}
RUN apk add ffmpeg
RUN \
  mkdir -p /opt/activities.next; \
  addgroup --system --gid "${GID}" app; \
  adduser --system --uid "${UID}" --home /opt/activities.next app
RUN corepack enable
WORKDIR /opt/activities.next
USER app

FROM base as build
ADD --chown=app:app . /opt/activities.next/
RUN yarn install --immutable
RUN yarn migrate
RUN yarn build
RUN yarn workspaces focus -A --production

FROM base as activities.next
ENV NODE_ENV="production"
ADD --chown=app:app . /opt/activities.next/
COPY --from=build --chown=app:app /opt/activities.next/.next /opt/activities.next/.next
COPY --from=build --chown=app:app /opt/activities.next/data.sqlite /opt/activities.next/data.sqlite
COPY --from=build --chown=app:app /opt/activities.next/node_modules /opt/activities.next/node_modules
EXPOSE 3000
CMD ["yarn", "start"]
