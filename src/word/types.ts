export type MeetingFormat = "线下" | "线上" | "混合" | "待补充";

export type ActionItemStatus = "未开始" | "进行中" | "已完成" | "待确认";

export interface MeetingMetadata {
  name: string;
  topic: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  format: MeetingFormat;
  host: string;
  recorder: string;
  attendees: string[];
  absentees: string[];
  project: string;
  confidentiality: string;
}

export interface DiscussionItem {
  topic: string;
  content: string;
  speaker?: string;
  keyPoints?: string[];
  sourceSegmentIds?: string[];
}

export interface Decision {
  content: string;
  sourceSegmentIds?: string[];
}

export interface ActionItem {
  task: string;
  owner: string;
  collaborators: string[];
  due: string;
  status: ActionItemStatus;
  notes: string;
  sourceSegmentIds?: string[];
}

export interface OpenIssue {
  issue: string;
  detail?: string;
  sourceSegmentIds?: string[];
}

export interface NextMeeting {
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  topic: string;
}

export interface MeetingMinutes {
  metadata: MeetingMetadata;
  agenda: string[];
  discussion: DiscussionItem[];
  decisions: Decision[];
  actionItems: ActionItem[];
  openIssues: OpenIssue[];
  nextMeeting: NextMeeting | null;
}

export interface MinutesValidationIssue {
  path: string;
  message: string;
}

export type MinutesValidationResult =
  | { success: true; data: MeetingMinutes }
  | { success: false; errors: MinutesValidationIssue[] };
