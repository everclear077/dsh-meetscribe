const nullableString = { type: ["string", "null"] } as const;
const stringArray = { type: "array", items: { type: "string" } } as const;
const nullableStringArray = {
  type: ["array", "null"],
  items: { type: "string" },
} as const;
const sourceSegments = {
  type: "array",
  items: { type: "string", minLength: 1 },
  description: "逐字稿中实际存在的 segmentId，按原值保留，不得编造。",
} as const;

export const MINUTES_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "结构化中文会议纪要",
  type: "object",
  additionalProperties: false,
  required: ["metadata"],
  properties: {
    metadata: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: nullableString,
        topic: nullableString,
        date: nullableString,
        startTime: nullableString,
        endTime: nullableString,
        location: nullableString,
        format: { enum: ["线下", "线上", "混合", "待补充", null] },
        host: nullableString,
        recorder: nullableString,
        attendees: nullableStringArray,
        absentees: nullableStringArray,
        project: nullableString,
        confidentiality: nullableString,
      },
    },
    agenda: stringArray,
    discussion: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "content"],
        properties: {
          topic: { type: "string", minLength: 1 },
          content: { type: "string", minLength: 1 },
          speaker: nullableString,
          keyPoints: stringArray,
          sourceSegmentIds: sourceSegments,
        },
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["content"],
        properties: {
          content: { type: "string", minLength: 1 },
          sourceSegmentIds: sourceSegments,
        },
      },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task"],
        properties: {
          task: { type: "string", minLength: 1 },
          owner: nullableString,
          collaborators: nullableStringArray,
          due: nullableString,
          status: { enum: ["未开始", "进行中", "已完成", "待确认", null] },
          notes: nullableString,
          sourceSegmentIds: sourceSegments,
        },
      },
    },
    openIssues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issue"],
        properties: {
          issue: { type: "string", minLength: 1 },
          detail: nullableString,
          sourceSegmentIds: sourceSegments,
        },
      },
    },
    nextMeeting: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        date: nullableString,
        startTime: nullableString,
        endTime: nullableString,
        location: nullableString,
        topic: nullableString,
      },
    },
  },
} as const;
