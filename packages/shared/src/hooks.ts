export type HookEventName =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "SubagentStart"
  | "SubagentStop"
  | "Notification"
  | "Stop"
  | "PermissionRequest"
  | "Elicitation"
  | "StopFailure";

export interface BasePayload {
  hook_event_name: HookEventName;
  session_id: string;
  cwd: string;
  transcript_path: string;
}

export interface SubAgentFields {
  agent_id: string;
  agent_type: string;
  agent_transcript_path: string;
}

export interface SessionStartPayload extends BasePayload {
  hook_event_name: "SessionStart";
  source: "startup" | "resume" | "clear" | "compact";
}

export interface SessionEndPayload extends BasePayload {
  hook_event_name: "SessionEnd";
  reason: string;
}

export interface UserPromptSubmitPayload extends BasePayload {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}

export interface PreToolUsePayload extends BasePayload {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
}

export interface PostToolUsePayload extends BasePayload {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
}

export interface PostToolUseFailurePayload extends BasePayload {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
}

export type NotificationType =
  | "permission_prompt"
  | "idle_prompt"
  | "auth_success"
  | "elicitation_dialog";

export interface NotificationPayload extends BasePayload {
  hook_event_name: "Notification";
  notification_type: NotificationType;
  message: string;
  title?: string;
}

export interface PermissionRequestPayload extends BasePayload {
  hook_event_name: "PermissionRequest";
  message?: string;
  title?: string;
}

export interface ElicitationPayload extends BasePayload {
  hook_event_name: "Elicitation";
  message?: string;
  title?: string;
}

export interface StopPayload extends BasePayload {
  hook_event_name: "Stop";
}

export interface StopFailurePayload extends BasePayload {
  hook_event_name: "StopFailure";
  reason?: string;
}

export interface SubagentStartPayload extends BasePayload, SubAgentFields {
  hook_event_name: "SubagentStart";
}

export interface SubagentStopPayload extends BasePayload, SubAgentFields {
  hook_event_name: "SubagentStop";
}

export type HookPayload =
  | SessionStartPayload
  | SessionEndPayload
  | UserPromptSubmitPayload
  | PreToolUsePayload
  | PostToolUsePayload
  | PostToolUseFailurePayload
  | SubagentStartPayload
  | SubagentStopPayload
  | NotificationPayload
  | PermissionRequestPayload
  | ElicitationPayload
  | StopPayload
  | StopFailurePayload;

export interface HookEnvelope {
  received_at: string;
  payload: HookPayload;
}

export const CONSUMED_EVENTS: readonly HookEventName[] = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "Stop",
  "PermissionRequest",
  "Elicitation",
  "StopFailure",
];
