import type {
  ActionItemStatus,
  MeetingFormat,
  MeetingMinutes,
  MinutesValidationIssue,
  MinutesValidationResult,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

const METADATA_KEYS = [
  "name",
  "topic",
  "date",
  "startTime",
  "endTime",
  "location",
  "format",
  "host",
  "recorder",
  "attendees",
  "absentees",
  "project",
  "confidentiality",
] as const;

const ROOT_KEYS = [
  "metadata",
  "agenda",
  "discussion",
  "decisions",
  "actionItems",
  "openIssues",
  "nextMeeting",
] as const;

const UNKNOWN_VALUES = /^(?:unknown|n\/?a|null|undefined|未知|不详|不清楚)$/i;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  errors: MinutesValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push({ path: `${path}.${key}`, message: "存在 schema 未定义的字段" });
    }
  }
}

function readString(
  value: unknown,
  path: string,
  fallback: string,
  errors: MinutesValidationIssue[],
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    errors.push({ path, message: "应为字符串或 null" });
    return fallback;
  }
  const text = value.trim();
  return text.length === 0 || UNKNOWN_VALUES.test(text) ? fallback : text;
}

function readRequiredString(
  value: unknown,
  path: string,
  errors: MinutesValidationIssue[],
): string {
  if (typeof value !== "string") {
    errors.push({ path, message: "应为非空字符串" });
    return "";
  }
  const text = value.trim();
  if (text.length === 0) {
    errors.push({ path, message: "不得为空字符串" });
  }
  return text;
}

function readOptionalString(
  value: unknown,
  path: string,
  errors: MinutesValidationIssue[],
): string | undefined {
  const text = readString(value, path, "", errors);
  return text.length > 0 ? text : undefined;
}

function readStringArray(
  value: unknown,
  path: string,
  errors: MinutesValidationIssue[],
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push({ path, message: "应为字符串数组或 null" });
    return [];
  }
  const result: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      errors.push({ path: `${path}[${index}]`, message: "应为非空字符串" });
      return;
    }
    result.push(entry.trim());
  });
  return result;
}

function readSourceSegmentIds(
  value: UnknownRecord,
  path: string,
  errors: MinutesValidationIssue[],
): string[] | undefined {
  if (value.sourceSegmentIds === undefined) return undefined;
  return readStringArray(value.sourceSegmentIds, `${path}.sourceSegmentIds`, errors);
}

function readArray(
  value: UnknownRecord,
  key: string,
  path: string,
  errors: MinutesValidationIssue[],
): unknown[] {
  const entries = value[key];
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries)) {
    errors.push({ path: `${path}.${key}`, message: "应为数组" });
    return [];
  }
  return entries;
}

function readEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  fallback: T,
  errors: MinutesValidationIssue[],
): T {
  const text = readString(value, path, fallback, errors);
  if (allowed.includes(text as T)) return text as T;
  errors.push({ path, message: `应为 ${allowed.join("、")} 之一` });
  return fallback;
}

export class MinutesValidationError extends Error {
  override readonly name = "MinutesValidationError";

  constructor(readonly issues: MinutesValidationIssue[]) {
    super(
      `会议纪要结构化数据校验失败：\n${issues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
}

export function sanitizeLlmJsonResponse(response: string): string {
  if (typeof response !== "string") {
    throw new TypeError("LLM 输出应为字符串。");
  }

  let text = response.replace(/^﻿/, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    text = fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace >= firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}

export function validateMinutes(value: unknown): MinutesValidationResult {
  const errors: MinutesValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      success: false,
      errors: [{ path: "$", message: "根节点应为 JSON 对象" }],
    };
  }

  checkKeys(value, ROOT_KEYS, "$", errors);
  const rawMetadata = isRecord(value.metadata) ? value.metadata : {};
  if (!isRecord(value.metadata)) {
    errors.push({ path: "$.metadata", message: "应为会议元数据对象" });
  }
  checkKeys(rawMetadata, METADATA_KEYS, "$.metadata", errors);

  const metadata = {
    name: readString(rawMetadata.name, "$.metadata.name", "待补充", errors),
    topic: readString(rawMetadata.topic, "$.metadata.topic", "待补充", errors),
    date: readString(rawMetadata.date, "$.metadata.date", "待补充", errors),
    startTime: readString(rawMetadata.startTime, "$.metadata.startTime", "待补充", errors),
    endTime: readString(rawMetadata.endTime, "$.metadata.endTime", "待补充", errors),
    location: readString(rawMetadata.location, "$.metadata.location", "待补充", errors),
    format: readEnum<MeetingFormat>(
      rawMetadata.format,
      "$.metadata.format",
      ["线下", "线上", "混合", "待补充"],
      "待补充",
      errors,
    ),
    host: readString(rawMetadata.host, "$.metadata.host", "待补充", errors),
    recorder: readString(rawMetadata.recorder, "$.metadata.recorder", "待补充", errors),
    attendees: readStringArray(rawMetadata.attendees, "$.metadata.attendees", errors),
    absentees: readStringArray(rawMetadata.absentees, "$.metadata.absentees", errors),
    project: readString(rawMetadata.project, "$.metadata.project", "待补充", errors),
    confidentiality: readString(
      rawMetadata.confidentiality,
      "$.metadata.confidentiality",
      "待补充",
      errors,
    ),
  };

  const agenda = readStringArray(value.agenda, "$.agenda", errors);
  const discussion: MeetingMinutes["discussion"] = [];
  readArray(value, "discussion", "$", errors).forEach((entry, index) => {
    const path = `$.discussion[${index}]`;
    if (!isRecord(entry)) {
      errors.push({ path, message: "应为讨论事项对象" });
      return;
    }
    checkKeys(entry, ["topic", "content", "speaker", "keyPoints", "sourceSegmentIds"], path, errors);
    const item: MeetingMinutes["discussion"][number] = {
      topic: readRequiredString(entry.topic, `${path}.topic`, errors),
      content: readRequiredString(entry.content, `${path}.content`, errors),
    };
    const speaker = readOptionalString(entry.speaker, `${path}.speaker`, errors);
    if (speaker !== undefined) item.speaker = speaker;
    if (entry.keyPoints !== undefined && entry.keyPoints !== null) {
      item.keyPoints = readStringArray(entry.keyPoints, `${path}.keyPoints`, errors);
    }
    const sourceSegmentIds = readSourceSegmentIds(entry, path, errors);
    if (sourceSegmentIds !== undefined) item.sourceSegmentIds = sourceSegmentIds;
    discussion.push(item);
  });

  const decisions: MeetingMinutes["decisions"] = [];
  readArray(value, "decisions", "$", errors).forEach((entry, index) => {
    const path = `$.decisions[${index}]`;
    if (!isRecord(entry)) {
      errors.push({ path, message: "应为决议对象" });
      return;
    }
    checkKeys(entry, ["content", "sourceSegmentIds"], path, errors);
    const decision: MeetingMinutes["decisions"][number] = {
      content: readRequiredString(entry.content, `${path}.content`, errors),
    };
    const sourceSegmentIds = readSourceSegmentIds(entry, path, errors);
    if (sourceSegmentIds !== undefined) decision.sourceSegmentIds = sourceSegmentIds;
    decisions.push(decision);
  });

  const actionItems: MeetingMinutes["actionItems"] = [];
  readArray(value, "actionItems", "$", errors).forEach((entry, index) => {
    const path = `$.actionItems[${index}]`;
    if (!isRecord(entry)) {
      errors.push({ path, message: "应为任务对象" });
      return;
    }
    checkKeys(
      entry,
      ["task", "owner", "collaborators", "due", "status", "notes", "sourceSegmentIds"],
      path,
      errors,
    );
    const action: MeetingMinutes["actionItems"][number] = {
      task: readRequiredString(entry.task, `${path}.task`, errors),
      owner: readString(entry.owner, `${path}.owner`, "待确认", errors),
      collaborators: readStringArray(entry.collaborators, `${path}.collaborators`, errors),
      due: readString(entry.due, `${path}.due`, "待确认", errors),
      status: readEnum<ActionItemStatus>(
        entry.status,
        `${path}.status`,
        ["未开始", "进行中", "已完成", "待确认"],
        "待确认",
        errors,
      ),
      notes: readString(entry.notes, `${path}.notes`, "", errors),
    };
    const sourceSegmentIds = readSourceSegmentIds(entry, path, errors);
    if (sourceSegmentIds !== undefined) action.sourceSegmentIds = sourceSegmentIds;
    actionItems.push(action);
  });

  const openIssues: MeetingMinutes["openIssues"] = [];
  readArray(value, "openIssues", "$", errors).forEach((entry, index) => {
    const path = `$.openIssues[${index}]`;
    if (!isRecord(entry)) {
      errors.push({ path, message: "应为未决问题对象" });
      return;
    }
    checkKeys(entry, ["issue", "detail", "sourceSegmentIds"], path, errors);
    const issue: MeetingMinutes["openIssues"][number] = {
      issue: readRequiredString(entry.issue, `${path}.issue`, errors),
    };
    const detail = readOptionalString(entry.detail, `${path}.detail`, errors);
    if (detail !== undefined) issue.detail = detail;
    const sourceSegmentIds = readSourceSegmentIds(entry, path, errors);
    if (sourceSegmentIds !== undefined) issue.sourceSegmentIds = sourceSegmentIds;
    openIssues.push(issue);
  });

  let nextMeeting: MeetingMinutes["nextMeeting"] = null;
  if (value.nextMeeting !== undefined && value.nextMeeting !== null) {
    if (!isRecord(value.nextMeeting)) {
      errors.push({ path: "$.nextMeeting", message: "应为对象或 null" });
    } else {
      const rawNext = value.nextMeeting;
      checkKeys(rawNext, ["date", "startTime", "endTime", "location", "topic"], "$.nextMeeting", errors);
      const values = {
        date: readOptionalString(rawNext.date, "$.nextMeeting.date", errors),
        startTime: readOptionalString(rawNext.startTime, "$.nextMeeting.startTime", errors),
        endTime: readOptionalString(rawNext.endTime, "$.nextMeeting.endTime", errors),
        location: readOptionalString(rawNext.location, "$.nextMeeting.location", errors),
        topic: readOptionalString(rawNext.topic, "$.nextMeeting.topic", errors),
      };
      if (Object.values(values).some((entry) => entry !== undefined)) {
        nextMeeting = {
          date: values.date ?? "待确认",
          startTime: values.startTime ?? "待确认",
          endTime: values.endTime ?? "待确认",
          location: values.location ?? "待确认",
          topic: values.topic ?? "待确认",
        };
      }
    }
  }

  if (errors.length > 0) return { success: false, errors };
  return {
    success: true,
    data: { metadata, agenda, discussion, decisions, actionItems, openIssues, nextMeeting },
  };
}

export function parseMinutesJson(response: string): MeetingMinutes {
  const sanitized = sanitizeLlmJsonResponse(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM 输出不是有效 JSON：${detail}`, { cause: error });
  }

  const result = validateMinutes(parsed);
  if (!result.success) throw new MinutesValidationError(result.errors);
  return result.data;
}

export function buildMinutesJson(data: unknown, space = 2): string {
  const result = validateMinutes(data);
  if (!result.success) throw new MinutesValidationError(result.errors);
  return JSON.stringify(result.data, null, space);
}
