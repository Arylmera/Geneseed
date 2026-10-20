# {{SKILL}}: spring-testing

> {{DESC_SPRING_TESTING}}

{{CREDIT:piomin-spring-boot:skills/testing-patterns/SKILL.md}}

{{CREDIT:piomin-spring-boot:skills/spring-boot/references/testing.md}}

**Trigger:** writing or fixing tests in a Spring Boot project: unit tests of services, `@WebMvcTest` / `@DataJpaTest` slices, `@SpringBootTest` integration tests, Testcontainers, mocking beans. Spring-specific; core test discipline lives in the test-gates and develop skills.

Target stack: Spring Boot 4, JUnit 5, Mockito, AssertJ.

## Pick the narrowest test

| Goal | Tool |
|------|------|
| Service logic | plain JUnit + `@ExtendWith(MockitoExtension.class)`, no Spring context |
| Controller mapping, validation, serialization | `@WebMvcTest(X.class)` + `MockMvcTester` + `@MockitoBean` |
| Repository queries, mappings | `@DataJpaTest` against the real database engine |
| Whole app over HTTP | `@SpringBootTest(webEnvironment = RANDOM_PORT)` + `@AutoConfigureRestTestClient` |
| Whole app, no server | `@SpringBootTest` + `@AutoConfigureMockMvc` |

Boot 4 split the test support into modules: slice annotations live in `org.springframework.boot.<module>.test.autoconfigure` (e.g. `org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest`); `@AutoConfigureTestDatabase` is in `org.springframework.boot.jdbc.test.autoconfigure`. Let the IDE import them. Use the matching test starter (`spring-boot-starter-data-jpa-test`, and so on) so each slice is on the classpath.

## Mocking beans

The Boot-era mock-bean annotations are gone in Boot 4. Use `@MockitoBean` and `@MockitoSpyBean` (from `org.springframework.test.context.bean.override.mockito`).

```java
@WebMvcTest(UserController.class)
class UserControllerTests {
    @Autowired MockMvcTester mvc;
    @MockitoBean UserService users;

    @Test
    void unknownUserIs404() {
        given(users.find("x")).willThrow(new UserNotFoundException("x"));
        assertThat(mvc.get().uri("/users/x")).hasStatus(HttpStatus.NOT_FOUND);
    }
}
```

`MockMvcTester` is AssertJ-based (`assertThat(mvc.get().uri(...)).hasStatusOk()`); do not mix it with the `expectStatus()` chain, which belongs to the other clients. Security: `@WithMockUser` still works on slices; `@Import` your security config.

## Full-server test

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureRestTestClient
class UserApiTests {
    @Autowired RestTestClient client;

    @Test
    void createReturns201() {
        client.post().uri("/users").contentType(MediaType.APPLICATION_JSON)
              .body(new UserRequest("a@example.com"))
              .exchange()
              .expectStatus().isCreated();
    }
}
```

`RestTestClient` resolves relative URIs against the running server; it also supports AssertJ-style assertions through its response type. Customize through a `RestTestClientBuilderCustomizer` bean.

## Real dependencies with Testcontainers

Prefer `@ServiceConnection`: Boot derives connection details, no property wiring.

```java
@TestConfiguration(proxyBeanMethods = false)
class ContainersConfig {
    @Bean @ServiceConnection
    PostgreSQLContainer postgres() { return new PostgreSQLContainer("postgres:16"); }
}

@DataJpaTest
@Import(ContainersConfig.class)
class AuthorRepositoryTests { /* ... */ }
```

- Testcontainers 2 containers are non-generic and live in per-module packages (`org.testcontainers.postgresql.PostgreSQLContainer`, artifact `testcontainers-postgresql`).
- The default `replace = NON_TEST` already keeps a `@ServiceConnection` data source; `replace = NONE` is only needed for a non-test `DataSource` you defined yourself.
- Where `@ServiceConnection` has no support for the container, use `@Testcontainers` + `@Container static` + `@DynamicPropertySource` to register the properties.
- Share one container configuration across tests so the context cache is reused.

## Rules

- Test behaviour through the public seam; do not assert on mock call counts unless the call is the behaviour.
- Slice tests load only what they need; reaching for `@SpringBootTest` to test one controller is a smell.
- Never replace the database engine with H2 when production runs another one; dialect differences hide bugs.
- No `Thread.sleep`: wait on the condition with a bounded timeout.

<!-- INCLUDE: skills/_self-improvement.md -->
