# {{SKILL}}: spring-boot — cloud-native

{{CREDIT:piomin-spring-boot:skills/spring-boot/references/cloud.md}}

Configuration, outbound clients, resilience, observability and packaging for a service that runs on Kubernetes or similar. Spring Cloud components (Config, Eureka, Gateway, LoadBalancer) ship in a release train tied to a Boot line: pick the train from the Spring Cloud supported-versions table, never mix trains. On Kubernetes, native service discovery and ConfigMaps often replace Eureka and Config Server; reach for those only when the platform lacks them.

## Config and secrets
```yaml
spring:
  config:
    import: "optional:configtree:/run/secrets/"
```
A Config Tree reads each mounted file as one property, so secrets stay out of environment variables and `/proc`. Mount the Kubernetes Secret read-only at that path.

## Declarative HTTP clients
Replace OpenFeign with an `@HttpExchange` interface. Boot registers groups; the URL and timeouts come from properties.

```java
@HttpExchange("/users")
public interface UserClient {
    @GetExchange("/{id}")
    UserResponse get(@PathVariable Long id);

    @PostExchange
    UserResponse create(@RequestBody UserCreateRequest request);
}

@SpringBootApplication
@ImportHttpServices(group = "users", types = UserClient.class)
public class App { }
```

```yaml
spring:
  http:
    serviceclient:
      users:
        base-url: "http://user-service"
        read-timeout: 2s
```

Without Boot's group support, build one by hand with `HttpServiceProxyFactory.builderFor(RestClientAdapter.create(restClient)).build().createClient(UserClient.class)`.

## Resilience
Framework 7 ships retry and concurrency limits in core. Enable them once, then annotate:

```java
@Configuration
@EnableResilientMethods
class ResilienceConfig { }

@Retryable(includes = IOException.class, maxRetries = 3, delay = 200, multiplier = 2, maxDelay = 2000)
public Quote fetch(String id) { ... }

@ConcurrencyLimit(10)
public void sendNotification() { ... }
```

Retry only idempotent calls. Circuit breaking: at the edge, use the Gateway `CircuitBreaker` filter; in-service, Resilience4j is still the common choice but its annotation and property names were not re-verified for Boot 4 here, so check its current docs before copying old config.

## Gateway
Spring Cloud Gateway's reactive server uses the `spring.cloud.gateway.server.webflux.*` prefix in current releases (older guides show `spring.cloud.gateway.*`). Prefer YAML routes over the Java DSL for simple cases.

```yaml
spring:
  cloud:
    gateway:
      server:
        webflux:
          routes:
            - id: users
              uri: lb://user-service
              predicates: [Path=/api/users/**]
              filters:
                - CircuitBreaker=usersBreaker
```

The `CircuitBreaker` filter needs a Spring Cloud CircuitBreaker starter (for example the reactor-Resilience4j one) on the classpath. Gateway is WebFlux; do not put it in the same module as a Spring MVC service.

## Observability
- Health: `/actuator/health/liveness` and `/actuator/health/readiness` are on by default (`management.endpoint.health.probes.enabled=false` disables them); point the Kubernetes probes at those, and permit `/actuator/health/**` in the security chain. Expose only what you need (`management.endpoints.web.exposure.include`), and protect the rest. `management.endpoint.health.show-components: always` with `show-details: when-authorized` tells an anonymous caller which component is down without leaking hosts or versions.
- Metrics: add `micrometer-registry-prometheus` and expose `prometheus`.
- Traces over OTLP: add `org.springframework.boot:spring-boot-starter-opentelemetry` and configure `management.opentelemetry.tracing.export.otlp.endpoint` (the old `management.otlp.tracing.*` keys are not the Boot 4 names). Boot samples 10% by default; set `management.tracing.sampling.probability: 1.0` only where the volume allows.
- Custom spans: `Observation.createNotStarted("order.process", registry).lowCardinalityKeyValue(...).observe(() -> ...)` (Micrometer Observation, unchanged by Boot 4 as far as the docs show).

## Lifecycle
```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```
Add a short Kubernetes `preStop` sleep so the endpoint leaves the load balancer before the JVM stops accepting work. Keep the pod's termination grace period longer than the shutdown phase timeout.

## Images
- No Dockerfile needed: `./mvnw spring-boot:build-image` builds an OCI image with Cloud Native Buildpacks (Paketo). With the native profile: `./mvnw -Pnative spring-boot:build-image`. Bind `build-image-no-fork` to `package` to build in CI.
- If you do write a Dockerfile: multi-stage, JRE-only runtime image, non-root user, `-XX:MaxRAMPercentage` instead of a fixed heap.
- GraalVM native: fast start and low memory, at the cost of build time and reflection hints; adopt it deliberately, not by default.
- Use whatever CI the project already has; do not introduce a new one.

## Local dependencies
Give each Docker Compose dependency a healthcheck, and make the services that need it wait with `depends_on: { <dep>: { condition: service_healthy } }`; `docker compose up -d --wait` then also returns only once everything is usable. Write a shell check as `["CMD-SHELL", "<script>"]`, never `["CMD", "bash", "-c", "<script>"]`: Podman splits that array on spaces and reports the service healthy before it starts.

## Kubernetes manifest essentials
Liveness and readiness probes on the actuator paths, a startup probe for slow starts, resource requests and limits, `runAsNonRoot`, config from ConfigMap and Secret. For TLS, let the platform terminate it (Ingress plus cert-manager) or mount the certificate and use an SSL bundle ([spring-boot/security.md](security.md)).

No committed manifest names a cluster, host, registry, namespace or secret value: no `namespace:` (it comes from `-n`), the image is a bare name (Skaffold `--default-repo`), Secrets are referenced by name and created out of band.

Dependencies deployed in the same namespace get the same three probes, or a redeploy routes traffic to a pod that is not ready:
- PostgreSQL: `pg_isready -h 127.0.0.1` (over TCP: during the first `initdb` the server listens only on its socket), a fast startup probe; data on a PVC with `strategy: Recreate`, or every redeploy starts empty.
- Keycloak: `KC_HEALTH_ENABLED=true`, then `/health/started`, `/health/ready`, `/health/live` on management port 9000, not 8080.

Prove a new probe can fail: watch the service start and see Warning events before it is up (`kubectl get events --field-selector type=Warning`), with no restarts in the pods that depend on it.

## One set of manifests for several platforms
When one service deploys to a local cluster, plain Kubernetes and OpenShift, use Kustomize overlays (deployed with Skaffold or `kubectl -k`):
- `deploy/base` is plain Kubernetes, valid anywhere; `deploy/overlays/<platform>` adds only what that platform needs (Routes on OpenShift, Ingresses elsewhere); environment overlays with hosts and TLS stay out of git.
- Stay within the kustomize 3.8 features that Skaffold, `kubectl -k` and `oc -k` all support (`resources`, `patches`, generators); no `labels`, `replacements` or `components`.
- Selectors stay `app: <name>`: a selector cannot change after the first deploy.
- CI runs `kustomize build` on every overlay, so a broken patch fails the build, not the deploy.
