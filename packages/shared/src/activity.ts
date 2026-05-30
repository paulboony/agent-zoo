// packages/shared/src/activity.ts

/** One hour's worth of activity for the chart. */
export interface ActivityBucket {
  /** ISO timestamp for the start of the hour this bucket covers. */
  hour_start: string;
  /** Count of PreToolUse events in this hour. */
  tool_calls: number;
}

/** A tool and how many times it failed over the window. */
export interface ToolFailureCount {
  tool: string;
  count: number;
}

/** Response shape for `GET /api/activity`: a rolling 24h window. */
export interface ActivityResponse {
  /** ISO timestamp the snapshot was generated. */
  generated_at: string;
  /** Exactly 24 buckets, oldest → newest, zero-filled for idle hours. */
  buckets: ActivityBucket[];
  /** Total interruptions (agent blocked on the user) in the last 24h. */
  interruptions_24h: number;
  /** PostToolUseFailure counts grouped by tool, sorted desc, last 24h. */
  failures_by_tool: ToolFailureCount[];
}
