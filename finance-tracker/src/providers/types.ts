import type { SyncPage } from '../core/types.js';

/**
 * The seam between this app and whatever bank-data aggregator sits behind it.
 *
 * Plaid is the default, but nothing above this interface knows that. The
 * contract is deliberately small — cursor-based change feeds are the common
 * denominator across Plaid, Teller, MX and SimpleFIN — so porting to another
 * aggregator means writing one file.
 */
export interface FinancialDataProvider {
  readonly name: string;

  /**
   * Fetch one page of changes since `cursor`. Pass `undefined` for a first
   * sync, which yields the full available history.
   *
   * Implementations must be idempotent with respect to the cursor: replaying
   * the same cursor must produce the same page, because we only advance the
   * stored cursor after the page's events are durably committed.
   */
  syncPage(accessToken: string, cursor: string | undefined): Promise<SyncPage>;

  /**
   * Ask the provider to pull fresh data from the institution right now.
   * Optional: not every provider supports on-demand refresh, and on Plaid it
   * is a paid add-on. Returning false means "not supported / not performed".
   */
  refresh?(accessToken: string): Promise<boolean>;

  /** Verify an inbound webhook. Returns false when the signature is bad. */
  verifyWebhook?(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<boolean>;
}

/** Raised when the connection needs the user to re-authenticate. */
export class ProviderReauthRequired extends Error {
  constructor(
    message: string,
    readonly itemId?: string,
  ) {
    super(message);
    this.name = 'ProviderReauthRequired';
  }
}

/**
 * A cursor the provider no longer recognises. The correct recovery is to sync
 * again from scratch with no cursor; the differ then treats the replayed
 * history as already-known and emits nothing, so no duplicate events appear.
 */
export class ProviderCursorInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderCursorInvalid';
  }
}

/** Provider is rate limiting us; back off and retry later. */
export class ProviderRateLimited extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderRateLimited';
  }
}
