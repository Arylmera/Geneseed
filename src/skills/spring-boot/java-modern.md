# {{SKILL}}: spring-boot — modern Java in Spring code

{{CREDIT:piomin-spring-boot:skills/java-modern/SKILL.md}}

{{CREDIT:piomin-spring-boot:skills/code-quality/SKILL.md}}

Java 21+ features and where they pay off in a Spring Boot codebase, plus the null-safety and Optional habits that prevent most runtime NPEs. This is a language reference for writing Spring code, not a review procedure.

## Where each feature fits
| Feature | Use for | Avoid when |
|---------|---------|------------|
| Records | DTOs, `@ConfigurationProperties`, value objects, events | JPA entities (Hibernate needs a no-arg constructor and mutable state), types needing inheritance |
| Sealed interfaces | Closed result and event hierarchies | Types that third parties must extend |
| Pattern-matching `switch` | Handling sealed types exhaustively, replacing `instanceof` chains | Plain equality checks |
| Virtual threads | Blocking I/O at high concurrency (`spring.threads.virtual.enabled: true`) | CPU-bound work |
| Text blocks | JPQL, SQL, JSON fixtures in tests | One-line strings |
| Sequenced collections | `getFirst()`, `getLast()`, `reversed()` on ordered collections | Unordered sets and maps |

## Records
```java
@ConfigurationProperties(prefix = "app.notification")
public record MailProperties(boolean enabled, String sender, Duration connectTimeout, Backoff backoff) {
    public record Backoff(int attempts, Duration pause) {}
}
```
Register with `@ConfigurationPropertiesScan` or `@EnableConfigurationProperties`. Constraint annotations on record components work with `@Validated` on the properties class.

## Sealed results and exhaustive switch
```java
public sealed interface PaymentResult permits Paid, Declined, Pending {}
public record Paid(String transactionId, BigDecimal amount) implements PaymentResult {}
public record Declined(String code, String message) implements PaymentResult {}
public record Pending(String reference) implements PaymentResult {}

String describe(PaymentResult result) {
    return switch (result) {
        case Paid p -> "Paid: " + p.transactionId();
        case Declined d -> "Declined: " + d.message();
        case Pending p -> "Pending: " + p.reference();
    };
}
```
No `default` branch on a sealed switch: adding a subtype then fails the build at every switch that must handle it. Use guards (`case Order o when o.total().signum() > 0 ->`) sparingly; a guard-heavy switch is usually a rules table in disguise.

Prefer a sealed result over an exception for expected outcomes (declined, not found); keep exceptions for the unexpected.

## Virtual threads
One property moves request handling and `@Async` work to virtual threads, so blocking JDBC and `RestClient` calls scale without reactive code. Pitfalls: a `synchronized` block that holds a monitor across blocking I/O pins the carrier thread on older JDKs (use `ReentrantLock`; Java 24+ lessens this), and thread-locals (MDC, security context) do not follow work onto another thread. Bound pools that guard scarce resources (the DB connection pool still limits real concurrency). Keep WebFlux for streaming, SSE or backpressure.

## Null safety and Optional
Spring Framework 7 and Boot 4 annotate their APIs with JSpecify (`@NullMarked`, `@Nullable`); use the same in your own packages so the compiler or IDE can check callers.

```java
// repository lookups: return Optional, decide at the edge
User user = repository.findById(id).orElseThrow(() -> new ResourceNotFoundException("User " + id));

// derive without unwrapping
String label = Optional.ofNullable(user.getNickname()).map(String::toUpperCase).orElse("");
```

Habits:
- `Optional` is a return type, not a field, parameter or collection element. Never `Optional.get()` without a prior check; use `orElseThrow`.
- Return an empty collection, never `null`.
- Do not catch `Exception` broadly or swallow it; wrap with the cause (`new ProcessingException("...", e)`) and log once, where it is handled.
- Open resources with try-with-resources.
- Chained calls on values that can be null (`a.getB().getC()`) need a guard or `Optional` mapping.

## Quick rules
- DTO or config -> record. Entity -> normal class.
- Closed set of outcomes -> sealed interface plus exhaustive switch.
- Blocking service -> virtual threads, not WebFlux.
