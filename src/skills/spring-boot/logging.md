# {{SKILL}}: spring-boot — logging

{{CREDIT:piomin-spring-boot:skills/logging-patterns/SKILL.md}}

SLF4J through Spring Boot's logging, with structured (JSON) output where logs are machine-read. Structured output is a good default for deployed environments and CI because fields parse directly (`jq`, log platforms, an AI assistant reading logs); keep readable text for local development.

## Structured logging (built in)
No extra dependency. Pick a format per target:

```yaml
logging:
  structured:
    format:
      console: logstash   # also: ecs, gelf
```

`logging.structured.format.file` does the same for file output. A custom Logback or Log4j2 config must use Boot's structured encoder or layout (`StructuredLogEncoder` / `StructuredLogLayout` fed by `CONSOLE_LOG_STRUCTURED_FORMAT`), or the property has no effect.

Profile split so developers keep readable logs:

```yaml
---
spring:
  config:
    activate:
      on-profile: "!local"
logging:
  structured:
    format:
      console: logstash
```

Run locally with the `local` profile for plain text. With Micrometer Tracing present, Boot adds `[traceId-spanId]` to every log line by default; change the format with `logging.pattern.correlation`. Whether they appear as JSON fields depends on the format; confirm in a real log line.

## Writing log statements
```java
private static final Logger log = LoggerFactory.getLogger(OrderService.class);

log.info("Order created id={} customer={}", order.id(), order.customerId()); // parameterized
log.error("Payment failed for order {}", order.id(), e);                      // exception last, stack trace kept
```
- Placeholders, never string concatenation. Guard only genuinely expensive arguments with `isDebugEnabled()`.
- Pass the exception as the final argument; do not log `e.getMessage()` alone.
- Log an exception once, where it is handled, not at every layer it passes through.
- Never log secrets, tokens, passwords or personal data; log identifiers.
- Lombok's `@Slf4j` is fine where the project uses Lombok; otherwise declare the logger as above.

| Level | Meaning |
|-------|---------|
| ERROR | Something failed and needs attention |
| WARN | Unexpected but handled (fallback used, retry succeeded) |
| INFO | Business events (order created, job finished) |
| DEBUG | Technical detail (queries, outbound calls) |
| TRACE | Verbose internals |

## MDC for correlation
MDC attaches key-value context to every log line written by the current thread. Set it at the edge in a filter and always clear it in `finally`.

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class MdcFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String header = req.getHeader("X-Request-Id");
        // client-supplied: accept only a short, safe value
        String id = header != null && header.matches("[A-Za-z0-9-]{1,64}") ? header : UUID.randomUUID().toString();
        MDC.put("requestId", id);
        try {
            chain.doFilter(req, res);
        } finally {
            MDC.remove("requestId");
        }
    }
}
```

MDC is thread-local, so it does not follow work handed to another thread (virtual or platform). For executor tasks, copy the context with a `TaskDecorator` (`MDC.getCopyOfContextMap()` before, `MDC.setContextMap(...)` inside the task, `MDC.clear()` in `finally`) and register it on the executor you use; check that Boot applies it to your executor in the version you run.

Useful fields for incident analysis: `requestId`, user or tenant id, and a duration on slow-path logs. Keep them to identifiers, not payloads.

## Quick reference
| Need | Use |
|------|-----|
| JSON console | `logging.structured.format.console: logstash` |
| Per-package level | `logging.level.com.example.orders: DEBUG` |
| Correlate a request | MDC `requestId` set in a filter |
| Follow one request in JSON logs | `jq 'select(.requestId == "abc")' app.log` (field name depends on MDC key and format) |
