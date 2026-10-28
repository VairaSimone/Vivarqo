# Backend localization

Vivarqo API supports Italian (`it`) and English (`en`) for human-readable API messages and transactional account emails.

## Locale selection

1. The authenticated account's saved `user.locale` setting takes precedence.
2. When the setting changes through `PATCH /api/v1/account`, that response uses the new language immediately.
3. Successful login, email verification and password reset use the affected account's saved language.
4. Requests without an authenticated account use the supported preference in `Accept-Language`; Italian is the fallback.
5. Registration accepts an optional `locale` field (`it` or `en`). If omitted, the request's `Accept-Language` is used.

Example account setting update:

```http
PATCH /api/v1/account
Content-Type: application/json

{ "locale": "en" }
```

The account locale is returned by `GET /api/v1/auth/me` and as part of the account data. The backend stores only the supported locale identifiers `it` and `en`.

## API contract

Human-readable top-level `message` values and validation issue messages are localized. The `code` field, HTTP status, JSON field names, validation `path` values, enum values, IDs and domain data remain stable. Frontends should branch on `code` rather than matching translated message text.

This localization layer only translates server-owned messages; it does not translate user-provided animal names, notes, document contents, imported data, CSV headers or domain values. Those formats remain stable for interoperability.
