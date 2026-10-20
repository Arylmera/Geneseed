# {{SKILL}}: spring-boot — web layer

{{CREDIT:piomin-spring-boot:skills/spring-boot/references/web.md}}

Controllers, validation, error handling and outbound HTTP for a Spring MVC service.

## Controller
Thin: bind, validate, delegate, shape the response. Create returns `201` with a `Location` header; delete returns `204`.

```java
@RestController
@RequestMapping("/api/v1/users")
class UserController {
    private final UserService service;

    UserController(UserService service) { this.service = service; }

    @GetMapping
    PagedModel<UserResponse> list(@PageableDefault(size = 20, sort = "createdAt") Pageable pageable) {
        return new PagedModel<>(service.findAll(pageable));
    }

    @PostMapping
    ResponseEntity<UserResponse> create(@Valid @RequestBody UserCreateRequest request) {
        UserResponse user = service.create(request);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest()
                .path("/{id}").buildAndExpand(user.id()).toUri();
        return ResponseEntity.created(location).body(user);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable Long id) { service.delete(id); }
}
```

Version the path (`/api/v1`). Use GET for reads, POST/PUT/PATCH/DELETE for state changes; never change state on GET.

## DTOs and validation
Records for request and response. Constraints sit on the record components (`jakarta.validation.constraints`); `@Valid` on the controller parameter triggers them. Put the entity-to-DTO mapping in a static factory or a mapper, not in the controller.

```java
public record UserCreateRequest(
        @NotBlank @Email String email,
        @NotBlank @Size(min = 8, max = 100) String password,
        @Min(18) Integer age) {}
```

A custom constraint is an annotation with `@Constraint(validatedBy = ...)` plus a `ConstraintValidator`; the validator may be a Spring bean and inject a repository. A uniqueness check in a validator is advisory only; the database constraint is the truth, so also handle `DataIntegrityViolationException` (409).

## Errors: Problem Details
Enable RFC 9457 responses for Spring's own exceptions:

```yaml
spring:
  mvc:
    problemdetails:
      enabled: true
```

Return `ProblemDetail` from your own handlers so every error shares one shape. Extending `ResponseEntityExceptionHandler` keeps the framework exceptions on that shape too.

```java
@RestControllerAdvice
class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    ProblemDetail notFound(ResourceNotFoundException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail conflict(DataIntegrityViolationException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "Resource already exists");
    }
}
```

A domain exception can carry its own problem by extending `ErrorResponseException`. Never put stack traces or SQL text in `detail`; log the exception server-side and return a generic message for the catch-all 500.

## Outbound HTTP
Blocking calls use `RestClient`; build it from the injected `RestClient.Builder` so Boot's customizers (timeouts, SSL, observability) apply.

```java
@Bean
RestClient pricingClient(RestClient.Builder builder) {
    return builder.baseUrl("https://api.example.com").build();
}

Quote fetch(String id) {
    return pricingClient.get().uri("/quotes/{id}", id)
            .retrieve()
            .onStatus(status -> status.value() == 404, (req, res) -> {
                throw new ResourceNotFoundException("Quote " + id);
            })
            .body(Quote.class);
}
```

Prefer an `@HttpExchange` interface when the remote API has several operations (see [spring-boot/cloud.md](cloud.md)). `WebClient` is for reactive or streaming code only.

## CORS
Prefer one bean over scattered annotations. With Spring Security on the classpath configure CORS in the security chain ([spring-boot/security.md](security.md)); otherwise `WebMvcConfigurer.addCorsMappings`. List explicit origins; `allowedOrigins("*")` cannot be combined with credentials.

## Quick reference
| Need | Use |
|------|-----|
| Page and sort | `Pageable` + `@PageableDefault` |
| Bad input | `@Valid` -> 400 Problem Details |
| Missing resource | 404 via your exception handler |
| Duplicate | 409 from the DB constraint |
| Slow upstream | `spring.http.clients.connect-timeout` / `read-timeout` |
