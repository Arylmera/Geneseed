# {{SKILL}}: spring-boot

> {{DESC_SPRING_BOOT}}

{{CREDIT:piomin-spring-boot:skills/spring-boot/SKILL.md}}

{{CREDIT:piomin-spring-boot:skills/conventions/SKILL.md}}

**Trigger:** writing or changing a Spring Boot application (Spring Boot 4, Spring Framework 7, Java 21+) — controllers, services, configuration, security, HTTP clients, logging, cloud-native deployment. Load it for any Spring Boot task, then read the side file the task needs. It does not replace the core review or refactor skills; for a Spring review or refactor, load those and use this one for the framework facts.

Target stack: Spring Boot 4 / Spring Framework 7 / Spring Security 7 / Hibernate 7 / Jakarta EE 11 / Java 21+. Check the project's actual versions first (`pom.xml` or `build.gradle`); if it is still on Boot 3, say so and do not apply the Boot 4 rows below blindly.

## Working loop
1. Read the build file, `application.yml` and the existing package layout. Match what the project already does (Maven or Gradle, its CI, its test style) before adding anything.
2. Confirm the design for anything beyond a small change: endpoints, DTOs, transaction boundaries, who authenticates.
3. Implement in layers, then run the project's own test command and read the output.

## Conventions
- Layering: controller (HTTP, validation) -> service (business logic, transactions) -> repository. Keep the package layout the project already has; for a new app a flat feature-or-layer split under one root package is fine (`com.example.<app>`).
- Constructor injection only; one constructor needs no `@Autowired`. Lombok is allowed where the project uses it.
- DTOs are records. JPA entities are not records. Never return an entity from a controller.
- `@Valid` on every request body; `@Transactional(readOnly = true)` on read services, `@Transactional` on mutating methods.
- Typed config: `@ConfigurationProperties` records instead of scattered `@Value`.
- Errors: one `@RestControllerAdvice`, Problem Details responses.
- Blocking outbound HTTP: `RestClient`, or an `@HttpExchange` interface. `WebClient` only for reactive or streaming code. Do not mix blocking and reactive in one call path.
- Jakarta namespaces only (`jakarta.persistence`, `jakarta.validation`, `jakarta.servlet`).
- Secrets from the environment or mounted files, never committed config.
- Tests: positive and negative cases; Testcontainers with `@ServiceConnection`; `@MockitoBean` for slice-test collaborators.
- Baseline properties worth enabling: `spring.threads.virtual.enabled: true`, `spring.mvc.problemdetails.enabled: true`, `server.shutdown: graceful`.

## Boot 4 pitfalls
Removed or renamed in Boot 4 (do not write them): `@MockBean` and `@SpyBean`, `ClientHttpRequestFactories`, `javax.persistence` (now `jakarta.persistence`), Spring Security 6 idioms such as `authorizeRequests` and `.and()` chains. <!-- banned: ok -->

| Old habit | Boot 4 / Framework 7 reality |
|-----------|------------------------------|
| Mock beans in slice tests | `@MockitoBean`, `@MockitoSpyBean` (`org.springframework.test.context.bean.override.mockito`) |
| Hand-built request factories | `ClientHttpRequestFactoryBuilder` with `HttpClientSettings` |
| Security configuration | Spring Security 7: lambda DSL, `authorizeHttpRequests` |
| `org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest` | `org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest`: slices moved to per-technology modules; import from the new packages |
| Jackson 2 (`com.fasterxml.jackson`) | Jackson 3 is the default (`tools.jackson`); Jackson 2 support is deprecated, `spring.jackson.use-jackson2-defaults` eases migration |
| `@DynamicPropertySource` for container URLs | `@ServiceConnection` on the container |
| MockMvc status assertions via Hamcrest | `MockMvcTester` (AssertJ) or `RestTestClient` with `@AutoConfigureRestTestClient` |
| OpenFeign for declarative clients | `@HttpExchange` interfaces, registered with `@ImportHttpServices` |
| Zipkin-only tracing setup | `spring-boot-starter-opentelemetry`, `management.opentelemetry.tracing.export.otlp.*` |
| Starters assumed to pull everything | Boot 4 starters are modular; add the matching starter or test starter for each technology, and read the migration guide when a class vanishes |

## Side files
- **Web/REST** -> read [spring-boot/web.md](spring-boot/web.md) and follow it.
- **Security (OAuth2 resource server, method security, SSL bundles)** -> read [spring-boot/security.md](spring-boot/security.md) and follow it.
- **Cloud-native (config, gateway, resilience, tracing, Kubernetes, images)** -> read [spring-boot/cloud.md](spring-boot/cloud.md) and follow it.
- **Modern Java in Spring code (records, sealed types, pattern matching, null safety)** -> read [spring-boot/java-modern.md](spring-boot/java-modern.md) and follow it.
- **Logging and structured logs** -> read [spring-boot/logging.md](spring-boot/logging.md) and follow it.

## Done when
- The project's build and tests pass, read from real output; no deprecated Boot 2/3 idiom was introduced; every new endpoint validates input and has a negative test.

<!-- INCLUDE: skills/_self-improvement.md -->
