# Event loss under crash

This measures the difference between writing an event and then publishing it, and committing the event together with the intent to publish it.

The result:

| Mode | Committed | Published | Lost | Loss |
|---|---|---|---|---|
| Dual write | 712 | 702 | 10 | 1.40% |
| Transactional outbox | 656 | 656 | 0 | 0.00% |

Twenty random `SIGKILL`s per mode. Same database, same Kafka topic, same publisher, same machine.

## Method

Each iteration:

1. Start a process that claims a recipient and then loops over accepted events.
2. Let the process run for a random 100 to 400 ms after it reports ready.
3. Kill it with `SIGKILL`.
4. Repeat twenty times for each mode.

After the last kill, the parent consumes the test topic from the beginning and compares the message IDs with the committed notification rows.

- **Dual write**: insert the notification, then publish to Kafka. The event is accepted once the insert commits.
- **Outbox**: insert the notification and an outbox row in one transaction. A separate relay publishes the outbox row after the kill.

The only difference is whether the intent to publish is part of the same commit as the event.

## Why the dual-write version loses events

There is always a window between the database commit and the broker acknowledgement. A process that dies inside that window has told the caller the event was accepted, but the event was never published. Nothing in the database knows it should be published later.

The outbox closes that window. The event and the intent to publish are one row set in one transaction. If the process dies before the relay runs, the outbox row survives, and the relay publishes it after restart. The relay can publish twice, but it cannot silently skip.

## Caveats

- The event shape is synthetic. The point is the commit boundary, not the notification content.
- The loss rate depends on how much of the process time is spent in the publish window. The number that matters is that the window exists, not that it is 1.40% on this laptop.
- The outbox relay was not killed in this test. A relay crash after a successful publish can duplicate a message, which the delivery claim and idempotency key absorb. A relay crash before publish leaves the outbox row pending.
- The test uses local Kafka with one partition. Network and broker latency would widen the dual-write window, not remove it.

## Reproduce

```bash
make demo
make loss-baseline
```

Results are written to `loss-results/latest.md` and `loss-results/latest.json`. The directory is ignored by git.
