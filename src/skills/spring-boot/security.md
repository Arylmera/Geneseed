# {{SKILL}}: spring-boot — security

{{CREDIT:piomin-spring-boot:skills/spring-boot/references/security.md}}

Spring Security 7. Default posture for an API: a stateless OAuth2 resource server that validates JWTs issued by an identity provider. Do not write your own token issuer, JWT filter or password store unless the task is explicitly to build an authorization server; that code is where the security bugs live.

## Resource server
Properties first (Boot builds the decoder from them):

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://auth.example.com
          audiences:
            - orders-api
```

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()));
        return http.build();
    }
}
```

- Lambda DSL only; `.and()` chaining and `authorizeRequests` are gone in Security 7.
- Disabling CSRF is acceptable only for a stateless, bearer-token API with no cookie-based session. If any endpoint authenticates with a cookie, keep CSRF on.
- `cors(Customizer.withDefaults())` picks up a `CorsConfigurationSource` bean; define that bean with explicit origins.
- Default JWT algorithm trust is RS256 only; widen it deliberately if the provider signs otherwise.

## Mapping claims to authorities
The default converter maps the `scope` claim to `SCOPE_` authorities. For roles in another claim:

```java
@Bean
JwtAuthenticationConverter jwtAuthenticationConverter() {
    var authorities = new JwtGrantedAuthoritiesConverter();
    authorities.setAuthoritiesClaimName("roles");
    authorities.setAuthorityPrefix("ROLE_");
    var converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(authorities);
    return converter;
}
```

Wire it with `oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter()))`.

## Validate audience
An issuer check alone accepts any token that issuer minted for any API. The `audiences` property in the YAML above makes Boot require the `aud` claim. Define your own `JwtDecoder` bean only when you need custom validators; it replaces the property-driven decoder, audiences included.

## Method security
`@EnableMethodSecurity` turns on `@PreAuthorize` and `@PostAuthorize`. Authorize in the service layer, next to the data, not only on URL patterns. The legacy Access API (`AccessDecisionManager`, voters) moved to the separate `spring-security-access` module; `@Secured` still works via `@EnableMethodSecurity(securedEnabled = true)`, but prefer `@PreAuthorize`.

```java
@PreAuthorize("hasRole('ADMIN') or #ownerId == authentication.name")
public Order find(String ownerId, Long id) { ... }
```

## Testing
Use the `jwt()` request post processor with MockMvc (`SecurityMockMvcRequestPostProcessors.jwt()`; default token has `scope=read`), or `@WithMockUser` for method security. Always test the 401 (no token) and 403 (wrong authority) paths, not only success.

## TLS with SSL bundles
Configure server and client TLS with SSL bundles (named key material). Reloading works only when the consuming component supports it (Tomcat and Netty servers) and only through the file watcher, so the material must be on the file system with a `file:` location; a `classpath:` bundle cannot reload.

```yaml
spring:
  ssl:
    bundle:
      pem:
        server:
          reload-on-update: true
          keystore:
            certificate: "file:/etc/ssl/app/tls.crt"
            private-key: "file:/etc/ssl/app/tls.key"
server:
  ssl:
    bundle: server
```

Tune detection with `spring.ssl.bundle.watch.file.quiet-period` (default 10s). Apply a bundle to an outbound `RestClient` with the `RestClientSsl` helper (it replaces any request factory you set earlier; use a separate `client` bundle with a `truststore` for the upstream, not the server's keystore bundle), or build a factory when you need more than SSL:

```java
RestClient client(RestClient.Builder builder, RestClientSsl ssl) {
    return builder.baseUrl("https://internal-service").apply(ssl.fromBundle("client")).build();
}
// more than SSL:
// var settings = HttpClientSettings.ofSslBundle(bundles.getBundle("client")).withReadTimeout(Duration.ofSeconds(5));
// builder.requestFactory(ClientHttpRequestFactoryBuilder.detect().build(settings))
```

## Checklist
- HTTPS everywhere outside local dev; secrets from env or mounted files ([spring-boot/cloud.md](cloud.md) covers config trees).
- Validate issuer and audience; keep token lifetimes short; never log tokens.
- Passwords (if you must store any): `PasswordEncoder` from `PasswordEncoderFactories`/BCrypt, never a plain hash.
- Rate-limit authentication endpoints at the gateway or proxy.
- Ask the `spring-security` agent for review (it hands the generic audit to `security`) when the change touches authentication or authorization.
