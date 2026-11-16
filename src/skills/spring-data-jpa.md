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
| Lost updates | `@Version` (optimistic); `@Lock(LockModeType.PESSIMISTIC_WRITE)` only for hot rows; across HTTP requests compare the client's version explicitly (see Transactions) |
| 500 after a successful update of a relation | `LazyInitializationException` on a proxy: make the write `@Transactional` and map the response inside it |
| Entity lost from a `HashSet` after persist | `equals`/`hashCode` on a generated id: use a natural key, or a constant `hashCode` |
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
- Equality on entities: a business key (`@NaturalId`), or id-based `equals` with a constant `hashCode` (for example `return 31;`) so the hash does not change when the id is assigned on persist. Use `instanceof`, not `getClass()`, in `equals`, and read the other side through `getId()`, not the field, so Hibernate proxies compare equal. Never include lazy collections in `equals`/`toString`.
- Bidirectional associations: helper methods (`addBook`/`removeBook`) keep both sides in sync. No cascade on the `@ManyToOne` side; `@ManyToMany` is a `Set` (a `List` deletes and re-inserts the whole join table) with `PERSIST`/`MERGE` only, never `REMOVE` or `ALL`. A link that carries data is its own entity.
- Audit timestamps are `Instant`, not `LocalDateTime`.

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
- Bulk `@Modifying` queries bypass the persistence context, callbacks, cascades and `@Version`: `flushAutomatically = true` writes pending changes first, `clearAutomatically = true` detaches stale entities after; increment the version in the query (`set a.version = a.version + 1`) when concurrent writers rely on it.
- A `LIKE` built from user input escapes `%`, `_` and `\` (with `cb.like(expr, pattern, '\\')`), or `q=%` matches everything.
- Return DTOs from the web layer, never entities.

## Transactions and open-in-view

- Put `@Transactional` on service methods, not repositories or controllers.
- `spring.jpa.open-in-view` defaults to `true` in a web app (the EntityManager stays open through view rendering). Set it to `false` and fetch explicitly; it hides N+1 otherwise.
- With open-in-view off, a write that loads outside a transaction and then calls `save` merges a detached entity: a newly set `@ManyToOne` becomes an uninitialized proxy, and mapping the response throws after the commit. Load, change, save and map in one `@Transactional` method; read paths fetch the relation with `@EntityGraph`.
- Optimistic locking over HTTP: the client sends the `version` it read and the service compares it, then throws `ObjectOptimisticLockingFailureException` (409). Setting the version on a managed entity does not work, as Hibernate ignores it. Do not wrap `save()` in a `try/catch` inside the transaction: the `UPDATE` runs at flush or commit, after the block. Return the new version with `saveAndFlush`.
- Detect N+1: `spring.jpa.show-sql=true` is enough for a quick look; assert query counts in a `@DataJpaTest` for regressions.

## Migrations

Schema is owned by migrations, not `ddl-auto`: `spring.jpa.hibernate.ddl-auto=validate` (or `none`) with Flyway or Liquibase, whichever the project already uses. In Boot 4 add the starter (`spring-boot-starter-flyway`), not just the Flyway core jar, or auto-configuration does not apply; Postgres and MySQL also need `flyway-database-postgresql` / `flyway-mysql`. No persistence or NoSQL only: no migration tool at all.

- Migration files are immutable once applied; every change is a new `V<n>__<description>.sql`, shipped in the same commit as the entity change.
- Numeric database-generated ids are standard identity columns (`GENERATED BY DEFAULT AS IDENTITY`, `AUTO_INCREMENT` on MySQL), not `SERIAL`/`BIGSERIAL`.
- Name constraints and indexes (`pk_`, `uk_`, `fk_`, `ck_`, `ix_`) and index every foreign key column; the exception handler maps a unique violation by that name.
- A new `NOT NULL` column gets a `DEFAULT` or a backfill. Column defaults match entity defaults; validation rules get a matching `CHECK`.
- A database that predates the tool: export its schema as `V1`, or `spring.flyway.baseline-on-migrate: true`.
- Integration tests run the real migrations on the production engine and assert none is pending (`flyway.info().pending()` empty).

## Outbox, saga, CQRS

Event-publishing alongside a DB write (dual-write problem), distributed workflows, read/write model split: read [spring-data-jpa/patterns.md](spring-data-jpa/patterns.md).

## Done when
- No lazy collection is touched outside a transaction; hot queries show one SELECT per use case in the SQL log; schema changes ship as a migration; imports are `jakarta.persistence`.

<!-- INCLUDE: skills/_self-improvement.md -->
