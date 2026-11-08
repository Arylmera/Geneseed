### Docker kit

Applies to Docker images and Compose stacks. Run `docker compose config` and read the merged result before changing a stack.

- Pin every image to a version tag or a digest. Never `latest`, never an untagged image.
- Order startup by health: `depends_on` with `condition: service_healthy` on a real readiness check.
- State lives in named volumes. Never run `docker compose down -v` or prune volumes on a stack with data without a backup and an explicit go-ahead.
- No secret in an image layer, a build argument, the Compose file or a committed `.env`; use Compose `secrets:` or the runtime environment from a git-ignored file.
- Images run as a non-root user, built multi-stage, with a `.dockerignore`.
- Every long-running service has a restart policy, resource limits and capped logs.
- Before an update, know the rollback target (the previous tag or digest); confirm the new container is healthy before pruning the old image.
