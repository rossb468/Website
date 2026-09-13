# finance-tracker

Two features against a bank account:

1. **Transaction notifications** — a push to your phone whenever something
   happens in a watched account.
2. **A complete change ledger** — every change to the account in chronological
   order, *including the ones your bank never keeps*: pending charges that
   appear and vanish, and amounts that move after the fact when a tip is added
   or a hold is released.

Run the whole thing right now, with no accounts and no API keys:

```bash
npm install
npm run cli -- demo
```

---

## Why the second feature is not trivial

A bank's transaction list is a view of the present, not a record of the past.
Three things happen constantly that it will not tell you about:

| What happens | What your bank shows you |
| --- | --- |
| You're charged $62.00, you tip $9.30, it settles at $71.30 | Only `$71.30` |
| A gas pump holds $100.00, then settles at $42.87 | Only `$42.87` |
| A $1.00 card-verification hold appears, then disappears | Nothing at all |

Aggregators do not help much either. Plaid's change feed reports only
`added`, `modified` and `removed` — never *what* changed. And critically:

> When a transaction moves from pending to posted, the pending transaction is
> not modified but instead is **removed** and a **new posted transaction is
> added**.
> — [Plaid, Transaction states](https://plaid.com/docs/transactions/transactions-data/)

So a settling charge arrives as a deletion plus an unrelated-looking insertion
under a brand-new ID. Naively, that reads as "a charge disappeared" and "a
different charge appeared" — and the $9.30 tip is lost entirely.

This project reconstructs the truth by keeping its own history and diffing it.

### How

```
provider change feed          ┌─────────────────────────────────────────┐
  added / modified / removed  │ 1. snapshot every observed state        │
            │                 │ 2. diff field-by-field against the last │
            ▼                 │ 3. stitch pending → posted              │
     ┌─────────────┐          │ 4. park ambiguous removals in limbo     │
     │ SyncEngine  │─────────▶│ 5. append derived events to the ledger  │
     └─────────────┘          └─────────────────────────────────────────┘
            │                                    │
            ▼                                    ▼
   pending_limbo (unresolved)            ledger_events (append-only)
            │                                    │
            └── grace period lapses ─────────────┘
                  → transaction.vanished
```

**Stitching.** A newly added posted transaction is matched to the pending
charge it settles, primarily via the provider's `pending_transaction_id`. Both
records are filed under one `lifecycle_id`, so a purchase reads as one thread
even though its ID changed. The difference between the authorized and settled
amounts becomes the event's `amountDelta` — that is the tip, or the released
hold, made explicit.

**Limbo.** When a pending charge leaves the feed, we cannot yet tell whether
it settled or evaporated; its replacement may simply not have been delivered
yet. So it waits in `pending_limbo` rather than being reported as either. If a
settlement claims it, it resolves as `posted`. If the grace period
(`PENDING_LIMBO_GRACE_HOURS`, default 72) lapses first, it resolves as
`transaction.vanished` — dated to when the charge actually disappeared, not
when we concluded it was gone, so the timeline reads in true order. While it
waits it is still visible, under `unresolvedPending` in the API.

**Fuzzy matching.** A meaningful minority of institutions never populate
`pending_transaction_id`. Without a fallback, every settled charge at those
banks would report as a vanished pending plus an unrelated new charge. So
unlinked settlements are scored against open limbo entries on amount
plausibility (a tip raises the amount ~15–25%; a released hold cuts it
sharply), date proximity, and description similarity after stripping processor
prefixes and store numbers. Scoring is deliberately conservative and declines
when two candidates are close — an unmatched pending is a much less harmful
error than welding two real purchases together.

**Integer money.** Amounts are stored as integer minor units, normalized so
negative means money left the account. Floats make change detection lie:
`12.20 - 12.10` is `0.09999999999999964`, which either invents changes or
misses real one-cent ones.

### Events the ledger records

| Type | Meaning |
| --- | --- |
| `transaction.added` | A charge we have never seen before (pending or posted) |
| `transaction.changed` | A field moved on a record that kept its ID |
| `transaction.posted` | A pending charge settled — carries the amount delta |
| `transaction.vanished` | A pending charge disappeared and never settled |
| `transaction.removed` | The bank withdrew a *posted* transaction |
| `balance.changed` | Account balance moved |
| `account.added` | A new account started being tracked |
| `sync.error` | A sync attempt failed, so ledger gaps are explainable |

---

## What the demo shows

`npm run cli -- demo` drives a simulated bank through a realistic few days and
prints the resulting ledger. `●` marks changes that would be invisible in your
bank's own history:

```
  ○ Pending $62.00 at TARTINE MANUFACTORY
  ● Posted $71.30 at TARTINE MANUFACTORY — increased by $9.30
      ↳ Authorized $62.00, settled $71.30
  ● Posted $42.87 at SHELL OIL 574 — decreased by $57.13
      ↳ Authorized $100.00, settled $42.87
  ● Pending $1.00 at AMZN TEMP AUTH disappeared without posting
      ↳ Left the account's pending list at …; never appeared as a posted transaction
  ● Posted $241.80 at MARRIOTT UNION SQ — decreased by $33.20
      ↳ Authorized $275.00, settled $241.80 (matched heuristically)
```

None of those deltas were reported by the provider. All were derived.

---

## Setup

### 1. Install and try it

```bash
npm install
npm run cli -- demo      # full simulation, no credentials needed
npm test                 # 84 tests
```

### 2. Configure

```bash
cp .env.example .env
```

The defaults (`PROVIDER=mock`, `NOTIFY_CHANNELS=console`) run without any
credentials. Everything below is for connecting a real bank and a real phone.

### 3. Choose a notification channel

| Channel | Cost | Setup | Notes |
| --- | --- | --- | --- |
| **ntfy** | Free | Pick a topic name, install the app | Easiest. iOS + Android. The topic name *is* the credential — make it long and unguessable |
| **Pushover** | ~$5 once | Create an app, copy two keys | Most reliable on iOS; priority 1 pierces Focus modes |
| **Web Push** | Free | `npm run cli -- vapid-keys` | Works in browsers and installed iOS PWAs (16.4+). No Apple Developer account needed |
| **console** | — | — | Default; prints instead of pushing |

Set `NOTIFY_CHANNELS=ntfy` (comma-separated for several), fill in the matching
variables, then check it end to end:

```bash
npm run cli -- notify-test
```

### 4. Try it against Plaid's fake bank first

Do this before connecting a real account. It exercises the entire production
code path — Link, token exchange, sync, ledger, push — against Plaid's
Sandbox, where the bank and the money are fictional.

From [dashboard.plaid.com](https://dashboard.plaid.com) → Team Settings →
Keys, copy your `client_id` and your **Sandbox** secret (Sandbox and
Production have different secrets):

```bash
# .env
PROVIDER=plaid
PLAID_ENV=sandbox
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_sandbox_secret
```

Start the server and open the connect page:

```bash
npm run dev
open http://localhost:4000/link
```

Click **Open Plaid Link**, pick any institution, and sign in with Plaid's
Sandbox credentials:

```
username: user_good
password: pass_good
```

The page shows a `plaid · sandbox` badge and a reminder of those credentials,
so it is always obvious whether you are one click from a real bank login.

On success the server exchanges the token, stores the connection, and runs
the first sync. Then:

```bash
npm run cli -- accounts     # the sandbox accounts, with balances
npm run cli -- timeline     # the ledger built from their history
```

You should see `account.added` and a run of `transaction.added` events. If
you configured a real notification channel, your phone will have buzzed.

<details>
<summary>Simulating a pending charge that changes</summary>

Sandbox accounts come with static history, so to watch the change engine work
you need to make something change. Plaid's `/sandbox/transactions/create`
endpoint can inject transactions into a Sandbox Item; add one as pending, sync,
then replace it with a settled version at a different amount and sync again.
The `transaction.posted` event will carry the delta.

The simulated bank does this end to end with no API calls at all:

```bash
npm run cli -- demo
```
</details>

### 5. Connect your real bank

Once Sandbox looks right, swap to production. You need `PLAID_ENV=production`
and your **Production** secret — the Sandbox one will not authenticate:

```bash
PLAID_ENV=production
PLAID_SECRET=your_production_secret
```

Restart, open `/link` again, and sign in with your actual bank. The badge will
read `plaid · production`.

If a connection later goes stale, Plaid marks it `needs_reauth`; open
`/link?itemId=<item_id>` to repair it in place without re-adding the account.

### 6. Run it for real

```bash
npm run build && npm start
```

---

## How updates arrive

Two paths, both wired up:

- **Webhooks** — set `PUBLIC_BASE_URL` and Plaid posts to
  `/webhooks/plaid` whenever an Item changes. Signatures are verified
  properly: the JWT in `Plaid-Verification` is checked against Plaid's
  published key *and* the body is hashed and compared to the token's
  `request_body_sha256` claim, because the JWT does not contain the body.
  Locally you'll need a tunnel (cloudflared, ngrok, tailscale funnel).
- **Polling** — every `POLL_INTERVAL_SECONDS` as a safety net, with
  exponential backoff on failure.

### Why refresh matters for time resolution

Plaid refreshes most Items only a few times a day on its own schedule.
Webhooks tell you promptly when *Plaid's* copy changed — but not when your
**bank's** copy changed. To catch a tip or a hold release close to when it
actually happens you need `/transactions/refresh`, which forces a pull from
the institution.

It is **included in Plaid's free Trial plan**, so
`ENABLE_TRANSACTIONS_REFRESH` defaults to `true` with a rate-limit floor of
10 minutes (`REFRESH_MIN_INTERVAL_SECONDS`). On some paid plans it is a
billable add-on — set it to `false` if you would rather not be charged.

Turned off, the ledger is still complete and correct; every change is still
captured. Only its time resolution degrades, from your poll interval to
Plaid's own refresh cadence.

### What Plaid costs

For a personal setup, probably nothing. Plaid offers a free **Trial plan** to
US/Canada developers creating a team on or after April 15, 2026: 10 Production
Items, real bank data, auto-approved, and Transactions Refresh included. An
Item is one bank login covering every account at that institution, so 10 is
far more than a personal tracker needs.

Beyond that, Pay-as-you-go has no minimum spend. Plaid does not publish exact
rates — they appear during the Production access request — and third-party
reports put Transactions near $0.30 per Item per month. Verify at signup;
these figures are secondhand.

---

## API

All routes except `/health` require `Authorization: Bearer $API_TOKEN`. With no
token configured, access is restricted to loopback.

| Route | Purpose |
| --- | --- |
| `GET /link` | Connect a bank (Plaid Link). Unauthenticated — it's where you enter the token |
| `GET /health` | Status, Plaid environment, per-item sync state, notification stats |
| `GET /api/timeline` | The change ledger. Filters: `accountId`, `types`, `since`, `until`, `limit`, `beforeId`, `order` |
| `GET /api/timeline/lifecycle/:id` | One purchase, authorization through settlement |
| `GET /api/transactions/:id/versions` | Every observed state of a record |
| `GET /api/accounts` | Accounts and their notification settings |
| `PATCH /api/accounts/:id/notifications` | `{ enabled, minAmount }` |
| `POST /api/sync` | Force a sync |
| `GET /api/sync/runs` | Recent sync runs |
| `POST /api/link/token` · `POST /api/link/exchange` | Plaid Link |
| `GET /api/push/public-key` · `POST /api/push/subscribe` | Web Push registration |
| `POST /webhooks/plaid` | Provider webhook receiver |

## CLI

```
demo            Full simulated account through the change ledger — start here
sync            Sync every connection once and notify
timeline [n]    Print the most recent n ledger events
accounts        List accounts and notification settings
notify-test     Send a test notification through every configured channel
vapid-keys      Generate a Web Push VAPID keypair
link            Mint a Plaid Link token
```

---

## Design notes

**Why Plaid, and what else.** Plaid has the broadest US institution coverage
and the cleanest cursor-based change feed, which is exactly the primitive this
project needs. But it sits behind a `FinancialDataProvider` interface, and
nothing above that interface knows it exists — swapping providers means writing
one file. Worth knowing about:

- **Teller** — free for personal use, direct bank APIs, cleaner pricing; much
  narrower institution coverage.
- **SimpleFIN Bridge** — ~$1.50/month, deliberately simple; a good fit for a
  single-user tool like this one.
- **GoCardless Bank Account Data** — free, but EU/UK only.
- **MX / Finicity / Akoya** — enterprise-oriented, harder to get started with.

If Plaid's pricing becomes annoying, Teller or SimpleFIN are the realistic
swaps, and the change-detection engine is entirely reusable.

**Why SQLite.** Single user, single writer, and the whole value proposition is
durable history. WAL mode lets the API read while a sync writes. The database
file is the product; back it up.

**Correctness properties worth knowing:**

- *Idempotent.* Cursors advance only after a page's events are committed in the
  same transaction. A crash mid-page replays that page; the differ sees no
  change and emits nothing. If the provider rejects a cursor, the engine
  restarts from scratch and the replayed history produces no duplicate events.
- *No duplicate notifications.* Delivery is claimed under a unique
  `(event, channel)` key before it is attempted, so a replayed sync, a
  double-delivered webhook, or a crash between sending and bookkeeping can
  never produce a second buzz.
- *Serialised per item.* A poll tick and a webhook arriving together join one
  sync rather than racing over the cursor.
- *Failures are audible.* A silent tracker looks exactly like a quiet account,
  so sync errors notify — backing off exponentially (failure 1, 2, 4, 8, …) so
  a bank outage does not spam.

## Project layout

```
src/
  config.ts          Env parsing and validation
  core/
    types.ts         Canonical domain types — the provider-agnostic vocabulary
    money.ts         Integer minor units
    diff.ts          Field-level change detection
    matcher.ts       Fuzzy pending → posted matching
    sync.ts          The engine: applies change feeds, derives the ledger
    orchestrator.ts  Sync + notify, serialised per item
    timeline.ts      Presentation over the ledger
  db/
    schema.sql       Annotated schema
    repositories.ts  Typed data access
  providers/
    types.ts         FinancialDataProvider — the swap seam
    plaid.ts         Plaid adapter, webhook verification
    mock.ts          Simulated bank with realistic pending lifecycles
  notify/
    render.ts        Event → push copy
    dispatcher.ts    Rules, dedupe, retry, delivery log
    channels/        ntfy · Pushover · Web Push · console
  server/app.ts      HTTP API, webhook receiver, /link
  scheduler.ts       Polling with backoff
public/link.html     Plaid Link connection page
test/                84 tests
```

## Status

Both features are functionally complete and tested end to end against the
simulated provider (84 tests). You can connect a bank and start collecting a
ledger today.

Not yet built:

- **A timeline UI.** `/link` is the only page; everything else is the API and
  CLI. The timeline is designed to be rendered but nothing renders it yet.
- **A deployment kit.** No Dockerfile, systemd unit, or backup script — see
  the setup notes above for what a server needs.

Known unknowns:

- **The Plaid adapter has never run against live credentials.** It is written
  to the documented API and the Sandbox path above exercises it, but the
  fuzzy matcher's scoring thresholds in particular are tuned against
  simulated data and deserve revisiting once real institutions have exercised
  them. Every fuzzy match records its confidence and reasons in the event's
  metadata, so they can be audited after the fact.
