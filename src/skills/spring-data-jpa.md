# {{SKILL}}: spring-data-jpa

> {{DESC_SPRING_DATA_JPA}}

{{CREDIT:piomin-spring-boot:skills/jpa-patterns/SKILL.md}}

{{CREDIT:piomin-spring-boot:skills/spring-boot/references/data.md}}

**Trigger:** a Spring Data JPA / Hibernate task in a Spring Boot project: entities, repositories, N+1 queries, `LazyInitializationException`, transactions, locking, projections, Flyway or Liquibase migrations, soft delete, or a transactional outbox. Spring-specific; for generic query or schema work outside Spring, do not load it.

Target stack: Spring Boot 4, Hibernate 7, Jakarta Persistence (`jakarta.persistence.*` only).

## Symptom to fix

| Symptom | Fix |
|---------|-----|
| N+1 SELECTs | `@EntityGraph(attributePaths = "books")` or `JOIN FETCH`; as a mitigation only, `hibernate.default_batch_fetch_size` (batch fetching mitigates N+1, it does not solve it) |
| `LazyInitializationException` | fetch what the use case needs inside the transaction (graph / `JOIN FETCH`) or return a DTO; do not flip associations to `EAGER` |
| Slow list endpoints | `Pageable` (`Slice` when no total is needed), interface or record projections, indexes |
| Lost updates | `@Version` (optimistic); `@Lock(LockModeType.PESSIMISTIC_WRITE)` only for hot rows |
| Slow read-only service | `@Transactional(readOnly = true)` on the class, override on writes |
| Transaction ignored | self-invocation bypasses the proxy: call through another bean |

## Entities

```java
@Entity
@SoftDelete                       // Hibernate: adds a deleted-flag column, filters reads
public class Author {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @Version private long version;
    @OneToMany(mappedBy = "author", fetch = FetchType.LAZY)
    private List<Book> books = new ArrayList<>();
    // getters/setters, or Lombok if the project uses it
}
```

- Every to-one and to-many is `LAZY`; decide fetching per query, not on the mapping.
- `@SoftDelete(strategy = ...)` takes `ACTIVE`, `DELETED`, or `TIMESTAMP`; the default stores a deleted flag.
- `GenerationType.UUID` generates the id in Java; `IDENTITY` and `SEQUENCE` need the database.
- Equality on entities: id-based with a stable hash, or business key. Never include lazy collections in `equals`/`toString`.

## Repositories and projections

```java
public interface AuthorRepository extends JpaRepository<Author, UUID> {
    @EntityGraph(attributePaths = "books")
    List<Author> findByNameStartingWith(String prefix);

    record AuthorName(UUID id, String name) {}
    List<AuthorName> findAllBy(Pageable pageable);          // DTO projection

    @Modifying(clearAutomatically = true)
    @Query("update Author a set a.name = :name where a.id = :id")
    int rename(UUID id, String name);
}
```

- Interface projections are built from tuple queries; DTO records need an all-args constructor and no column aliases in `@Query` JPQL.
- Bulk `@Modifying` queries bypass the persistence context: `clearAutomatically = true` or reload.
- Return DTOs from the web layer, never entities.

## Transactions and open-in-view

- Put `@Transactional` on service methods, not repositories or controllers.
- `spring.jpa.open-in-view` defaults to `true` in a web app (the EntityManager stays open through view rendering). Set it to `false` and fetch explicitly; it hides N+1 otherwise.
- Detect N+1: `spring.jpa.show-sql=true` is enough for a quick look; assert query counts in a `@DataJpaTest` for regressions.

## Migrations

Schema is owned by migrations, not `ddl-auto`: `spring.jpa.hibernate.ddl-auto=validate` (or `none`) with Flyway or Liquibase, whichever the project already uses. In Boot 4 add the starter (`spring-boot-starter-flyway`), not just the Flyway core jar, or auto-configuration does not apply; Postgres and MySQL also need `flyway-database-postgresql` / `flyway-mysql`. Migration files are immutable once merged; add a new one.

## Outbox, saga, CQRS

Event-publishing alongside a DB write (dual-write problem), distributed workflows, read/write model split: read [spring-data-jpa/patterns.md](spring-data-jpa/patterns.md).

## Done when
- No lazy collection is touched outside a transaction; hot queries show one SELECT per use case in the SQL log; schema changes ship as a migration; imports are `jakarta.persistence`.

<!-- INCLUDE: skills/_self-improvement.md -->
