# {{SKILL}}: spring-data-jpa — outbox, saga, CQRS

{{CREDIT:piomin-spring-boot:skills/design-patterns/SKILL.md}}

Use when a write must also publish an event, a business process spans services, or reads and writes need separate models. If a plain `@Transactional` method does the job, do not add these.

## Transactional outbox

Dual write (save, then publish to a broker) can lose or duplicate the event. Write the event row in the same transaction as the state change; a separate relay publishes it.

```java
@Entity
public class OutboxEvent {
    @Id @GeneratedValue(strategy = GenerationType.UUID) UUID id;
    String aggregateId;
    String type;
    @Column(columnDefinition = "text") String payload;
    boolean published;
    // constructor, getters
}

@Service
class OrderService {
    @Transactional
    public Order place(OrderRequest req) {
        Order order = orders.save(Order.from(req));
        outbox.save(new OutboxEvent(order.getId().toString(), "OrderPlaced", json(order)));
        return order;                         // both rows commit or neither does
    }
}

@Component
class OutboxRelay {
    @Scheduled(fixedDelay = 1000)             // needs @EnableScheduling on a config class
    @Transactional
    void relay() {
        for (OutboxEvent e : outbox.findTop100ByPublishedFalseOrderByIdAsc()) {
            publisher.send(e);                // broker client; may throw, row stays unpublished
            e.setPublished(true);
        }
    }
}
```

- Delivery is at-least-once: consumers dedupe on the event id.
- Several relay instances will pick the same rows. Use a single relay, or a row-claiming query verified for your database (not covered here), or a lock.
- Delete or archive published rows on a schedule.
- In-process alternative: publish a Spring `ApplicationEvent` and handle it with `@TransactionalEventListener` (default phase `AFTER_COMMIT`). The handler runs only if the transaction commits, and it is not durable: a crash after commit loses the event. Use it for in-JVM side effects, the outbox table for anything that must survive a crash. If the listener must write to the database again, annotate it `@Transactional(propagation = Propagation.REQUIRES_NEW)`.

## Saga

| Style | Mechanism | Pick when |
|-------|-----------|-----------|
| Choreography | each service reacts to the previous service's event and emits its own (events through the outbox) | few steps, no central owner |
| Orchestration | one `OrderSaga` component sends commands, tracks state in its own table, issues compensations | many steps, branching, need to see where a flow is stuck |

- Every step has a compensating action (cancel, refund, release); compensations must be idempotent.
- Persist saga state (`STARTED`, `PAYMENT_DONE`, `FAILED`, ...) with `@Version` so concurrent events cannot both advance it.
- Timeouts are events too: a scheduled job moves stale sagas to compensation.
- Messaging infrastructure (Spring Cloud Stream, plain Kafka or AMQP clients) is project-specific and not verified here; keep the saga logic behind a small publisher interface.

## CQRS

Split only when read and write shapes diverge. Smallest useful form, same database:

- Write side: aggregate entities and `@Transactional` command services.
- Read side: projection or DTO-record repository methods (or a view) behind a `@Transactional(readOnly = true)` query service; never return entities.
- A separate read store fed by outbox events adds eventual consistency: show it in the API (version or timestamp) and accept stale reads.
