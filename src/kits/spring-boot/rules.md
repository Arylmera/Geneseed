### Spring Boot kit

Applies to Spring Boot 4 projects (Spring Framework 7, Java 21+). Read the project's own pom.xml or Gradle build first and check any API you reach for against the version it pins; do not assume a newer or older one.

- Inject through constructors only. No field-level `@Autowired`.
- Blocking HTTP calls use `RestClient`. Do not add new `RestTemplate` code.
- Persistence and validation imports are `jakarta.*`, never `javax.*`.
- Tests that need a database or broker use Testcontainers wired with `@ServiceConnection`, not hand-copied connection properties.
- Replace beans in tests with `@MockitoBean` and `@MockitoSpyBean`; the older Boot test-package mock and spy bean annotations are removed.
- Match the project's existing style, build tool and CI before introducing another.
