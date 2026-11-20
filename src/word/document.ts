import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { MeetingMinutes } from "./types.js";

const NAVY = "17365D";
const TEAL = "168C8C";
const TEXT = "263442";
const MUTED = "64748B";
const BORDER = "D6E2E8";
const PALE_TEAL = "EAF4F4";
const PALE_BLUE = "F4F7FA";
const WHITE = "FFFFFF";

const BODY_FONT = {
  ascii: "Calibri",
  hAnsi: "Calibri",
  eastAsia: "SimSun",
} as const;
const HEADING_FONT = {
  ascii: "Aptos Display",
  hAnsi: "Aptos Display",
  eastAsia: "Microsoft YaHei",
} as const;

const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 1276;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const INFO_WIDTHS = [1250, 3427, 1250, 3427] as const;
const ACTION_WIDTHS = [520, 2890, 1000, 1180, 1150, 900, 1714] as const;
const NEXT_MEETING_WIDTHS = [1500, CONTENT_WIDTH - 1500] as const;
const BULLET_LIST = "minutes-bullets";
const DECISION_LIST = "minutes-decisions";

function inlineText(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
}

function metadataText(value: unknown): string {
  return inlineText(value) || "待补充";
}

function confirmationText(value: unknown): string {
  return inlineText(value) || "待确认";
}

function minutesTitle(value: unknown): string {
  const name = metadataText(value);
  return name.endsWith("会议纪要") ? name : `${name}会议纪要`;
}

function bodyParagraph(
  text: string,
  options: {
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    indent?: { left?: number; firstLine?: number };
    numbering?: { reference: string; level: number };
    color?: string;
  } = {},
): Paragraph {
  return new Paragraph({
    alignment: options.alignment ?? AlignmentType.JUSTIFIED,
    numbering: options.numbering,
    indent: options.indent,
    spacing: { after: 120, line: 340, lineRule: LineRuleType.AUTO },
    children: [
      new TextRun({
        text: inlineText(text),
        font: BODY_FONT,
        size: 21,
        color: options.color ?? TEXT,
      }),
    ],
  });
}

function sectionHeading(title: string, index: number): Paragraph {
  const numerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const prefix = numerals[index - 1] ?? String(index);
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 5 },
    },
    children: [new TextRun({ text: `${prefix}、${title}`, font: HEADING_FONT })],
  });
}

interface CellStyle {
  bold?: boolean;
  color?: string;
  fill?: string;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  gridSpan?: number;
  size?: number;
}

function tableCell(text: string, width: number, style: CellStyle = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: style.gridSpan,
    verticalAlign: VerticalAlign.CENTER,
    shading: style.fill
      ? { type: ShadingType.CLEAR, color: "auto", fill: style.fill }
      : undefined,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    children: [
      new Paragraph({
        alignment: style.align ?? AlignmentType.START,
        spacing: { before: 0, after: 0, line: 270, lineRule: LineRuleType.AUTO },
        children: [
          new TextRun({
            text: inlineText(text),
            font: BODY_FONT,
            size: style.size ?? 20,
            bold: style.bold,
            color: style.color ?? TEXT,
          }),
        ],
      }),
    ],
  });
}

const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
} as const;

function infoRow(
  firstLabel: string,
  firstValue: string,
  secondLabel?: string,
  secondValue?: string,
): TableRow {
  const cells =
    secondLabel === undefined
      ? [
          tableCell(firstLabel, INFO_WIDTHS[0], {
            bold: true,
            color: NAVY,
            fill: PALE_TEAL,
            align: AlignmentType.CENTER,
          }),
          tableCell(
            firstValue,
            INFO_WIDTHS[1] + INFO_WIDTHS[2] + INFO_WIDTHS[3],
            { gridSpan: 3 },
          ),
        ]
      : [
          tableCell(firstLabel, INFO_WIDTHS[0], {
            bold: true,
            color: NAVY,
            fill: PALE_TEAL,
            align: AlignmentType.CENTER,
          }),
          tableCell(firstValue, INFO_WIDTHS[1]),
          tableCell(secondLabel, INFO_WIDTHS[2], {
            bold: true,
            color: NAVY,
            fill: PALE_TEAL,
            align: AlignmentType.CENTER,
          }),
          tableCell(secondValue ?? "", INFO_WIDTHS[3]),
        ];
  return new TableRow({ children: cells, cantSplit: true });
}

function buildInfoTable(data: MeetingMinutes): Table {
  const metadata = data.metadata;
  const attendees = metadata.attendees?.length
    ? metadata.attendees.map(inlineText).filter(Boolean).join("、")
    : "待补充";
  const absentees = metadata.absentees?.length
    ? metadata.absentees.map(inlineText).filter(Boolean).join("、")
    : "待补充";
  const meetingTime = `${metadataText(metadata.startTime)}—${metadataText(metadata.endTime)}`;

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [...INFO_WIDTHS],
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    rows: [
      infoRow("会议名称", metadataText(metadata.name)),
      infoRow("会议主题", metadataText(metadata.topic)),
      infoRow("会议日期", metadataText(metadata.date), "会议时间", meetingTime),
      infoRow("会议地点", metadataText(metadata.location), "会议形式", metadataText(metadata.format)),
      infoRow("主持人", metadataText(metadata.host), "记录人", metadataText(metadata.recorder)),
      infoRow("参会人员", attendees || "待补充"),
      infoRow("缺席人员", absentees || "待补充"),
      infoRow(
        "关联项目",
        metadataText(metadata.project),
        "保密级别",
        metadataText(metadata.confidentiality),
      ),
    ],
  });
}

function buildActionTable(data: MeetingMinutes): Table {
  const headers = ["序号", "工作事项", "负责人", "协同人", "完成时限", "状态", "备注"];
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map((header, index) =>
      tableCell(header, ACTION_WIDTHS[index], {
        bold: true,
        color: WHITE,
        fill: NAVY,
        align: AlignmentType.CENTER,
      }),
    ),
  });

  const rows = data.actionItems
    .filter((item) => inlineText(item.task))
    .map((item, index) => {
      const values = [
        String(index + 1),
        inlineText(item.task),
        confirmationText(item.owner),
        item.collaborators?.map(inlineText).filter(Boolean).join("、") || "—",
        confirmationText(item.due),
        confirmationText(item.status),
        inlineText(item.notes) || "—",
      ];
      return new TableRow({
        cantSplit: true,
        children: values.map((value, column) =>
          tableCell(value, ACTION_WIDTHS[column], {
            fill: index % 2 === 1 ? PALE_BLUE : undefined,
            align:
              column === 1 || column === 6 ? AlignmentType.START : AlignmentType.CENTER,
          }),
        ),
      });
    });

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [...ACTION_WIDTHS],
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    rows: [headerRow, ...rows],
  });
}

function nextMeetingRow(label: string, value: string): TableRow {
  return new TableRow({
    cantSplit: true,
    children: [
      tableCell(label, NEXT_MEETING_WIDTHS[0], {
        bold: true,
        color: NAVY,
        fill: PALE_TEAL,
        align: AlignmentType.CENTER,
      }),
      tableCell(value, NEXT_MEETING_WIDTHS[1]),
    ],
  });
}

function buildNextMeetingTable(data: MeetingMinutes): Table {
  const next = data.nextMeeting;
  if (!next) throw new Error("下次会议数据为空。");
  const time = `${confirmationText(next.startTime)}—${confirmationText(next.endTime)}`;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [...NEXT_MEETING_WIDTHS],
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    rows: [
      nextMeetingRow("会议日期", confirmationText(next.date)),
      nextMeetingRow("会议时间", time),
      nextMeetingRow("会议地点", confirmationText(next.location)),
      nextMeetingRow("会议议题", confirmationText(next.topic)),
    ],
  });
}

export function createMinutesDocument(data: MeetingMinutes): Document {
  const metadata = data.metadata;
  const title = minutesTitle(metadata.name);
  const agenda = (data.agenda ?? []).map(inlineText).filter(Boolean);
  const discussion = (data.discussion ?? []).filter(
    (item) => inlineText(item.topic) && inlineText(item.content),
  );
  const decisions = (data.decisions ?? []).filter((item) => inlineText(item.content));
  const actionItems = (data.actionItems ?? []).filter((item) => inlineText(item.task));
  const openIssues = (data.openIssues ?? []).filter((item) => inlineText(item.issue));
  const hasNextMeeting =
    data.nextMeeting !== null &&
    data.nextMeeting !== undefined &&
    Object.values(data.nextMeeting).some((value) => inlineText(value));

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL, space: 10 },
      },
      children: [
        new TextRun({
          text: title,
          font: HEADING_FONT,
          bold: true,
        }),
      ],
    }),
    buildInfoTable(data),
    new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }),
  ];

  let sectionIndex = 0;
  if (agenda.length > 0) {
    children.push(sectionHeading("会议议题", ++sectionIndex));
    agenda.forEach((item) => {
      children.push(
        bodyParagraph(item, {
          alignment: AlignmentType.START,
          numbering: { reference: BULLET_LIST, level: 0 },
        }),
      );
    });
  }

  if (discussion.length > 0) {
    children.push(sectionHeading("讨论主要内容", ++sectionIndex));
    discussion.forEach((item) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: inlineText(item.topic), font: HEADING_FONT })],
        }),
      );
      const speaker = inlineText(item.speaker);
      children.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 120, line: 340, lineRule: LineRuleType.AUTO },
          children: [
            ...(speaker
              ? [
                  new TextRun({
                    text: `${speaker}：`,
                    font: BODY_FONT,
                    size: 21,
                    bold: true,
                    color: NAVY,
                  }),
                ]
              : []),
            new TextRun({
              text: inlineText(item.content),
              font: BODY_FONT,
              size: 21,
              color: TEXT,
            }),
          ],
        }),
      );
      (item.keyPoints ?? []).map(inlineText).filter(Boolean).forEach((point) => {
        children.push(
          bodyParagraph(point, {
            numbering: { reference: BULLET_LIST, level: 0 },
          }),
        );
      });
    });
  }

  if (decisions.length > 0) {
    children.push(sectionHeading("会议决定事项", ++sectionIndex));
    decisions.forEach((item) => {
      children.push(
        bodyParagraph(item.content, {
          numbering: { reference: DECISION_LIST, level: 0 },
        }),
      );
    });
  }

  if (actionItems.length > 0) {
    children.push(sectionHeading("任务分工及完成时限", ++sectionIndex));
    children.push(buildActionTable({ ...data, actionItems }));
  }

  if (openIssues.length > 0) {
    children.push(sectionHeading("尚未解决的问题", ++sectionIndex));
    openIssues.forEach((item) => {
      children.push(
        bodyParagraph(item.issue, {
          numbering: { reference: BULLET_LIST, level: 0 },
        }),
      );
      const detail = inlineText(item.detail);
      if (detail) {
        children.push(
          bodyParagraph(detail, {
            indent: { left: 420 },
            color: MUTED,
          }),
        );
      }
    });
  }

  if (hasNextMeeting) {
    children.push(sectionHeading("下次会议安排", ++sectionIndex));
    children.push(buildNextMeetingTable(data));
  }

  return new Document({
    creator: "dsh-meetscribe",
    title,
    subject: metadataText(metadata.topic),
    description: "由 dsh-meetscribe 生成的结构化会议纪要",
    keywords: "会议纪要,会议记录,dsh-meetscribe",
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 21, color: TEXT },
          paragraph: {
            spacing: { after: 120, line: 340, lineRule: LineRuleType.AUTO },
          },
        },
        title: {
          run: { font: HEADING_FONT, size: 36, bold: true, color: NAVY },
          paragraph: {
            spacing: { before: 0, after: 260 },
            keepNext: true,
          },
        },
        heading1: {
          run: { font: HEADING_FONT, size: 27, bold: true, color: NAVY },
          paragraph: {
            spacing: { before: 300, after: 150 },
            keepNext: true,
          },
        },
        heading2: {
          run: { font: HEADING_FONT, size: 23, bold: true, color: TEAL },
          paragraph: {
            spacing: { before: 180, after: 100 },
            keepNext: true,
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLET_LIST,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.START,
              style: {
                paragraph: { indent: { left: 440, hanging: 240 } },
                run: { font: BODY_FONT, color: TEAL },
              },
            },
          ],
        },
        {
          reference: DECISION_LIST,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: {
                paragraph: { indent: { left: 460, hanging: 300 } },
                run: { font: BODY_FONT, color: NAVY, bold: true },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: PAGE_WIDTH,
              height: PAGE_HEIGHT,
              orientation: PageOrientation.PORTRAIT,
            },
            margin: {
              top: 1134,
              right: PAGE_MARGIN,
              bottom: 1134,
              left: PAGE_MARGIN,
              header: 560,
              footer: 560,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 5, color: TEAL, space: 4 },
                },
                spacing: { after: 0 },
                children: [
                  new TextRun({
                    text: title,
                    font: HEADING_FONT,
                    size: 17,
                    color: MUTED,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({
                    children: [
                      "第 ",
                      PageNumber.CURRENT,
                      " 页 / 共 ",
                      PageNumber.TOTAL_PAGES,
                      " 页",
                    ],
                    font: BODY_FONT,
                    size: 18,
                    color: MUTED,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

export async function buildMinutesDocx(data: MeetingMinutes): Promise<Buffer> {
  return Packer.toBuffer(createMinutesDocument(data));
}

export async function generateMinutesDocx(
  data: MeetingMinutes,
  outputPath: string,
): Promise<string> {
  if (typeof outputPath !== "string" || outputPath.trim().length === 0) {
    throw new Error("输出路径不能为空。");
  }
  const buffer = await buildMinutesDocx(data);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, buffer);
  return outputPath;
}
