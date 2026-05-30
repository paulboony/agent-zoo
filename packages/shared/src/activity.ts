// packages/shared/src/activity.ts

/** One hour's worth of activity counts. */
export interface ActivityBucket {
  /** ISO timestamp for the start of the hour this bucket covers. */
  hour_start: string;
  /** Count of PreToolUse events in this hour. */
  tool_calls: number;
  /** Count of SubagentStart events in this hour. */
  subagents: number;
  /** Count of PostToolUseFailure + StopFailure events in this hour. */
  errors: number;
}

/** Response shape for `GET /api/activity`: a rolling 24h window. */
export interface ActivityResponse {
  /** ISO timestamp the snapshot was generated. */
  generated_at: string;
  /** Exactly 24 buckets, oldest → newest, zero-filled for idle hours. */
  buckets: ActivityBucket[];
}
