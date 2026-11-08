# {{SKILL}}: compose-ops

> {{DESC_COMPOSE_OPS}}

{{CREDIT:everything-claude-code:skills/docker-patterns/SKILL.md}}

**Trigger:** writing, reviewing or operating a `compose.yaml` (or `docker-compose.yml`) stack, or a generic Dockerfile for it: startup order, health, volumes, image pins, env and secrets, restart, limits, logs, networks, image size and user, or an update that must be safe to roll back. Stack-agnostic. A Spring Boot service's own image (Buildpacks, layered or native jar) belongs to the spring-boot kit's `docker-expert` agent when that kit is on, and so does that service's local-dev Compose file; this skill owns how every other stack is composed and run.

## Working loop
1. Read the Compose file, every `-f` override and `.env` it uses, then the merged result: `docker compose config`. It resolves variables, merges overrides and fails on a bad key.
2. Check what runs now before changing it: `docker compose ps`, `docker compose images` (the real tags and digests), `docker compose logs --tail=100 <svc>`.
3. Change, `docker compose config` again, then apply and confirm each changed service is `healthy` (or, for a service with no healthcheck, `running` with clean logs).

## Startup order and health
- `depends_on: { db: { condition: service_healthy } }` waits for the dependency's healthcheck. A bare `depends_on: [db]` waits only for the container to start, not for the database to accept connections.
- Give every service others depend on a `healthcheck:` that tests readiness: `test: ["CMD", "pg_isready", "-U", "app"]`, with `interval`, `timeout`, `retries` and a `start_period` long enough for a cold start. The command must exist in the image; a missing `curl` makes the check fail forever.
- `condition: service_completed_successfully` for a one-shot job (a migration) that must finish first.

## Volumes
| Use | Mount |
|---|---|
| Data the service owns (database, uploads) | named volume: `pgdata:/var/lib/postgresql/data`, declared under top-level `volumes:` |
| Config or source you edit on the host | bind mount, read-only where possible: `./nginx.conf:/etc/nginx/nginx.conf:ro` |
| Scratch that must not persist | `tmpfs:` |

- A named volume survives `down` and keeps Docker-managed permissions; a bind mount takes the host path's owner and breaks a non-root container whose UID does not match.
- `docker compose down -v` deletes named volumes, which is data loss. Never run it on a stack with state unless deleting the data is the intent and a backup exists.
- An anonymous volume (a container path with no name) carries over when `up` recreates the container, but is orphaned after `down` then `up`, or with `up -V` (`--renew-anon-volumes`), and its data is no longer mounted; name it.

## Images
- Pin every `image:` to a version tag (`postgres:16.4`), and to a digest (`postgres:16.4@sha256:...`) where the stack must reproduce exactly. Never `latest` and never no tag: an update must be a change in the file.
- Your own images: multi-stage builds, so the final stage carries only the runtime and the built output, not compilers or dev dependencies. Start from a slim or distroless base, and add a `.dockerignore` (`.git`, `node_modules`, build output, `.env`).
- Run as a non-root user: `USER app` in the Dockerfile, or `user: "1000:1000"` in Compose. Add `read_only: true` with a `tmpfs:` for write paths, `cap_drop: [ALL]` and `security_opt: ["no-new-privileges:true"]` where the service allows.

## Env and secrets
- `.env` holds non-secret settings and the values the file interpolates (`${TAG:?set TAG}` fails loudly when unset). It is git-ignored; commit a `.env.example` with placeholders instead.
- Secrets go in `secrets:` (a file outside the repository, mounted at `/run/secrets/<name>`), read by images that support `*_FILE` variables (`POSTGRES_PASSWORD_FILE`). An `environment:` secret shows in `docker inspect` and in every child process.
- Never bake a secret into an image: `ARG`/`ENV` values stay in the layer history. Use `RUN --mount=type=secret,id=...` for a build-time secret.

## Running: restart, limits, logs
- `restart: unless-stopped` for long-running services; `restart: "no"` for one-shot jobs. A service that crash-loops hides its error behind restarts: read `docker compose logs` before raising retries.
- Set limits so one service cannot starve the host: `deploy: { resources: { limits: { cpus: "1.0", memory: 512M } } }`, or `mem_limit:` on older engines. A JVM or Node process also needs its heap capped below the limit.
- Cap logs: `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }` (or `local`). The default json-file driver grows until the disk is full.

## Networks
- Services reach each other by service name on the stack's default network; never hard-code container IPs.
- Split networks by trust: a `frontend` network for the proxy and the app, a `backend` network with `internal: true` for the database, which then has no route out and no published port.
- Publish only the ports users reach, bound to an address where possible: `"127.0.0.1:5432:5432"` for a local-only database. A published port bypasses host firewall rules on most Linux setups.

## Safe updates
1. Record the current state: the running image digests (`docker compose images`) and the committed Compose file. Back up the named volumes of a stateful service before an update that may migrate its data.
2. Change the pinned tag in the file, then `docker compose pull <svc>`.
3. `docker compose up -d <svc>` recreates only the services whose image or configuration changed. Add `--wait` (with `--wait-timeout <seconds>`) to block until they are running or healthy; `--wait` only proves health for a service that has a healthcheck, so give one to every service you update.
4. Check health and logs. Roll back by restoring the previous tag or digest and running `up -d` again; a data migration the new version ran may not roll back, which is why step 1 takes the backup.
5. Prune old images only after the new version has proved itself: `docker image prune -a` deletes every image no container uses, the rollback target included (plain `docker image prune` removes only dangling images).

## Done when
- `docker compose config` accepts the merged file, every changed service with a healthcheck reports `healthy` and the others are `running` with clean logs, images are pinned, no secret sits in the file, an image or `environment:`, and the rollback target (the previous tag or digest, and a backup for stateful data) is known.
