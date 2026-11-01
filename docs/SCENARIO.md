# Failure and recovery scenarios

## One command

From the repository root:

```bash
make scenario
```

If the stack is not ready, the target runs `make demo` first. It then runs two scenarios in sequence:

1. Provider timeout, unknown delivery, DLQ, replay.
2. Worker killed with SIGKILL after accepting events, restart, drain, and no-loss checks.

Results are written to `scenario-results/timeout.md`, `scenario-results/timeout.json`, `scenario-results/worker-kill.md`, and `scenario-results/worker-kill.json`. That directory is ignored by git.

## Timeout to DLQ to replay

`make scenario-timeout` sends one booking event to a recipient with an active push device, forces the mock push provider to time out, and waits for the reconciler.

The sequence is:

1. Accept the event and commit the notification and outbox row.
2. The delivery worker attempts push and receives a timeout after the request body is written.
3. The delivery enters `unknown`.
4. The reconciler inspects it after two seconds, cannot resolve it because there is no provider message ID, marks it failed, and writes a DLQ row.
5. The scenario clears the provider fault and replays the DLQ.
6. The delivery worker retries with the same delivery ID and idempotency key.
7. The push delivery is accepted. The notification, inbox item, and outbox state are checked.

The scenario asserts:

- One notification exists for the idempotency key.
- The timeout was observed.
- The DLQ row points to the failed delivery.
- Dry run does not publish.
- Replay moves the delivery to accepted or delivered.
- The notification ID does not change.
- The inbox has one item for the notification.
- The outbox drains.

The recorded local run completed the full path in about 4.3 seconds.

## Worker kill

`make scenario-kill` accepts 24 booking events, waits briefly, kills the worker with SIGKILL, restarts it, and waits for every notification to reach a terminal state.

The scenario checks:

- Every accepted event still has its notification.
- Every notification reaches a terminal state.
- No channel has two deliveries for the same notification.
- The outbox drains.

The scheduler recovers `pending`, `sending`, and `retry_scheduled` deliveries that are older than 30 seconds. It also republishes `accepted` notifications that have no fanout plan and are older than 30 seconds. Those paths cover lost Kafka messages and workers that die between a database commit and offset commit.

The recorded local run recovered 24 notifications in about 32.5 seconds after SIGKILL.

## Failover

`make scenario-failover` runs the existing Postgres standby drill. It promotes the standby, starts the API and worker against it, and waits for the outbox to drain. It is separate because it stops the default stack.

## What is not covered

- A worker crash while a provider request is in flight on a real vendor.
- A Kafka broker failure.
- A Redis failure.
- A full regional failover.
- Exactly-once provider delivery.

The tests prove at-least-once recovery and idempotency, not exactly-once provider behavior.
