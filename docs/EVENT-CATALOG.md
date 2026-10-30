# Event catalog

The catalog is stored in `event_types` and seeded from `packages/contracts/src/catalog.ts`. Producers reference the type by key and schema version. The API validates the envelope with Zod and the event `data` object with the stored JSON Schema.

## Envelope

| Field | Type | Notes |
|---|---|---|
| `type` | string | Lowercase, dot-separated, for example `booking.confirmed` |
| `schema_version` | integer | Starts at 1 and is immutable per version |
| `recipient` | object | `{ "external_id": "cust_1042" }` |
| `idempotency_key` | string | Stable per business event |
| `data` | object | Type-specific payload, validated by the catalog |
| `priority` | string, optional | Only accepted when the event type allows it |

Every response includes a trace ID. Ingest returns `202` after the Postgres transaction commits.

## Types

### `booking.confirmed`

- Source: `booking`
- Default priority: `normal`
- Channels: `email`, `in_app`, `push`
- Dedupe window: 24 hours
- Category: `booking`
- Quiet hours: respected
- CRM caps: email 5/day, in-app 40/day, push 20/day
- Template key: `booking_confirmation`

```json
{
  "type": "booking.confirmed",
  "schema_version": 1,
  "recipient": { "external_id": "cust_1042" },
  "idempotency_key": "booking:bkg_8821:confirmed",
  "data": {
    "booking_id": "bkg_8821",
    "service": "plumbing",
    "pro_name": "Ravi",
    "scheduled_for": "2026-11-02T10:00:00+05:30",
    "address_label": "Home"
  }
}
```

Required data fields: `booking_id`, `service`, `scheduled_for`.

### `booking.canceled`

- Source: `booking`
- Default priority: `high`
- Channels: `email`, `in_app`, `push`
- Dedupe window: 24 hours
- Category: `booking`
- Template key: `booking_cancellation`

Required data fields: `booking_id`, `service`, `scheduled_for`.

### `payment.failed`

- Source: `payments`
- Default priority: `high`
- Channels: `email`, `in_app`
- Dedupe window: 1 hour
- Category: `billing`
- Quiet hours: respected
- Template key: `payment_failure`

```json
{
  "type": "payment.failed",
  "schema_version": 1,
  "recipient": { "external_id": "cust_1042" },
  "idempotency_key": "payment:pay_7712:failed",
  "data": {
    "payment_id": "pay_7712",
    "amount": 2499,
    "currency": "INR",
    "retry_url": "https://marlowe.example/pay/retry"
  }
}
```

Required data fields: `payment_id`, `amount`, `currency`.

### `security.alert`

- Source: `security`
- Default priority: `critical`
- Channels: `email`, `in_app`, `push`
- Dedupe window: 5 minutes
- Category: `security`
- Quiet hours: always bypassed for critical priority
- Template key: `security_alert`

```json
{
  "type": "security.alert",
  "schema_version": 1,
  "recipient": { "external_id": "cust_1042" },
  "idempotency_key": "security:evt_991:login",
  "data": {
    "alert": "new_device_login",
    "device": "Chrome on Linux",
    "location": "Pune",
    "occurred_at": "2026-10-30T09:15:00Z"
  }
}
```

Required data fields: `alert`.

Critical events bypass quiet hours, marketing pauses, and preference opt-outs. Hard suppression still wins.

### `campaign.message`

- Source: `growth`
- Default priority: `low`
- Channels: `email`, `in_app`, `push`
- Dedupe window: 30 days
- Category: `marketing`
- Marketing opt-in: required
- Caps: email 1/day, in-app 3/day, push 2/day
- Template key: from `data.template_key`, default `winback`

```json
{
  "type": "campaign.message",
  "schema_version": 1,
  "recipient": { "external_id": "cust_1042" },
  "idempotency_key": "campaign:cmp_501:cust_1042",
  "data": {
    "campaign_id": "cmp_501",
    "template_key": "winback",
    "campaign_channel": "email",
    "offer": "20 percent off your next cleaning"
  }
}
```

Required data fields: `campaign_id`.

The campaign runner sets `campaign_channel`, and the orchestrator filters the fanout to that channel. A campaign never bypasses validation, idempotency, preferences, quiet hours, caps, or suppression.

## Priority overrides

`allow_priority_override` is false for every seeded type. A producer may only override priority when the event type explicitly allows it. An override on a locked type returns `422`.

## Template keys

| Event type | Template key |
|---|---|
| `booking.confirmed` | `booking_confirmation` |
| `booking.canceled` | `booking_cancellation` |
| `payment.failed` | `payment_failure` |
| `security.alert` | `security_alert` |
| `campaign.message` | `winback` or `data.template_key` |

Templates are keyed by `(key, channel, locale)`. Locale resolution is exact locale, then language, then `en`.

## Adding a type

1. Add a definition to `packages/contracts/src/catalog.ts`.
2. Create a template for each allowed channel and locale.
3. Seed or create the row through `POST /v1/admin/event-types` with scope `catalog:write`.
4. Add a producer test that sends a valid and an invalid payload.
5. Document it here.

A producer cannot create an event type. Catalog writes require an operator key with `catalog:write`.

## Compatibility

A schema change creates a new `schema_version`. The old version remains active so producers can migrate at their own pace. The API selects the exact `(key, version)` from the request. It does not guess.
