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

const NAVY = "202020";
const TEAL = "404040";
const TEXT = "202020";
const MUTED = "666666";
const BORDER = "A6A6A6";
const PALE_TEAL = "F2F2F2";
const PALE_BLUE = "FAFAFA";
const WHITE = "FFFFFF";

const BODY_FONT = {
  ascii: "Times New Roman",
  hAnsi: "Times New Roman",
  eastAsia: "FangSong",
} as const;
const HEADING_FONT = {
  ascii: "Arial",
  hAnsi: "Arial",
  eastAsia: "SimHei",
} as const;

const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 1587;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const INFO_WIDTHS = [1300, 3066, 1300, 3066] as const;
const ACTION_WIDTHS = [520, 3300, 1000, 1100, 1600, 1212] as const;
const NEXT_MEETING_WIDTHS = [1500, CONTENT_WIDTH - 1500] as const;
const BULLET_LIST = "minutes-bullets";
const AGENDA_LIST = "minutes-agenda";
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
    spacing: { after: 120, line: 560, lineRule: LineRuleType.EXACT },
    children: [
      new TextRun({
        text: inlineText(text),
        font: BODY_FONT,
        size: 24,
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
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 },
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
  const headers = ["序号", "工作事项及交付要求", "负责人", "协同人", "完成时限", "状态"];
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map((header, index) =>
      tableCell(header, ACTION_WIDTHS[index], {
        bold: true,
        color: TEXT,
        fill: PALE_TEAL,
        align: AlignmentType.CENTER,
      }),
    ),
  });

  const rows = data.actionItems
    .filter((item) => inlineText(item.task))
    .map((item, index) => {
      const task = inlineText(item.task);
      const notes = inlineText(item.notes);
      const taskCell = new TableCell({
        width: { size: ACTION_WIDTHS[1], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: index % 2 === 1 ? { type: ShadingType.CLEAR, color: "auto", fill: PALE_BLUE } : undefined,
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        children: [
          new Paragraph({
            spacing: { after: notes ? 60 : 0, line: 300, lineRule: LineRuleType.AUTO },
            children: [new TextRun({ text: task, font: BODY_FONT, size: 20, color: TEXT })],
          }),
          ...(notes ? [new Paragraph({
            spacing: { after: 0, line: 280, lineRule: LineRuleType.AUTO },
            children: [new TextRun({ text: `交付说明：${notes}`, font: BODY_FONT, size: 18, color: MUTED })],
          })] : []),
        ],
      });
      const values = [
        String(index + 1),
        confirmationText(item.owner),
        item.collaborators?.map(inlineText).filter(Boolean).join("、") || "—",
        confirmationText(item.due),
        confirmationText(item.status),
      ];
      const columns = [0, 2, 3, 4, 5];
      return new TableRow({
        cantSplit: true,
        children: [
          tableCell(values[0], ACTION_WIDTHS[0], { fill: index % 2 === 1 ? PALE_BLUE : undefined, align: AlignmentType.CENTER }),
          taskCell,
          ...values.slice(1).map((value, position) => tableCell(value, ACTION_WIDTHS[columns[position + 1]], {
            fill: index % 2 === 1 ? PALE_BLUE : undefined,
            align: AlignmentType.CENTER,
          })),
        ],
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

export interface MinutesDocumentOptions {
  /** Custom templates provide their own title and metadata placeholders. */
  bodyOnly?: boolean;
}

export function createMinutesDocument(data: MeetingMinutes, options: MinutesDocumentOptions = {}): Document {
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

  const children: (Paragraph | Table)[] = options.bodyOnly ? [] : [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 280 },
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
          numbering: { reference: AGENDA_LIST, level: 0 },
        }),
      );
    });
  }

  if (discussion.length > 0) {
    children.push(sectionHeading("讨论要点", ++sectionIndex));
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
          spacing: { after: 120, line: 560, lineRule: LineRuleType.EXACT },
          children: [
            ...(speaker
              ? [
                  new TextRun({
                    text: `${speaker}：`,
                    font: BODY_FONT,
                    size: 24,
                    bold: true,
                    color: NAVY,
                  }),
                ]
              : []),
            new TextRun({
              text: inlineText(item.content),
              font: BODY_FONT,
              size: 24,
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
    children.push(sectionHeading("议定事项", ++sectionIndex));
    decisions.forEach((item) => {
      children.push(
        bodyParagraph(item.content, {
          numbering: { reference: DECISION_LIST, level: 0 },
        }),
      );
    });
  }

  if (actionItems.length > 0) {
    children.push(sectionHeading("任务分工", ++sectionIndex));
    children.push(buildActionTable({ ...data, actionItems }));
  }

  if (openIssues.length > 0) {
    children.push(sectionHeading("待核实事项", ++sectionIndex));
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

  if (!options.bodyOnly) {
    children.push(new Paragraph({
      alignment: AlignmentType.END,
      spacing: { before: 420, after: 0, line: 360, lineRule: LineRuleType.AUTO },
      children: [new TextRun({
        text: `整理：${metadataText(metadata.recorder)}    审核确认：________________`,
        font: BODY_FONT,
        size: 20,
        color: MUTED,
      })],
    }));
  }

  return new Document({
    creator: "dsh-meetscribe",
    title,
    subject: metadataText(metadata.topic),
    description: "会议纪要",
    keywords: "会议纪要,会议记录,dsh-meetscribe",
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 24, color: TEXT },
          paragraph: {
            spacing: { after: 120, line: 560, lineRule: LineRuleType.EXACT },
          },
        },
        title: {
          run: { font: HEADING_FONT, size: 44, bold: true, color: TEXT },
          paragraph: {
            spacing: { before: 0, after: 280 },
            keepNext: true,
          },
        },
        heading1: {
          run: { font: HEADING_FONT, size: 28, bold: true, color: TEXT },
          paragraph: {
            spacing: { before: 320, after: 160 },
            keepNext: true,
          },
        },
        heading2: {
          run: { font: HEADING_FONT, size: 24, bold: true, color: TEXT },
          paragraph: {
            spacing: { before: 200, after: 100 },
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
          reference: AGENDA_LIST,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: {
                paragraph: { indent: { left: 460, hanging: 300 } },
                run: { font: BODY_FONT, color: TEXT },
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
              top: 1701,
              right: PAGE_MARGIN,
              bottom: 1417,
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

export async function buildMinutesDocx(data: MeetingMinutes, options: MinutesDocumentOptions = {}): Promise<Buffer> {
  return Packer.toBuffer(createMinutesDocument(data, options));
}

export interface GenerateMinutesOptions extends MinutesDocumentOptions {
  /** Validated immutable DOCX bytes captured when the generation task starts. */
  template?: Uint8Array;
}

export async function generateMinutesDocx(
  data: MeetingMinutes,
  outputPath: string,
  options: GenerateMinutesOptions = {},
): Promise<string> {
  if (typeof outputPath !== "string" || outputPath.trim().length === 0) {
    throw new Error("输出路径不能为空。");
  }
  const buffer = options.template
    ? (await import("./template.js")).applyMinutesTemplate(data, options.template)
    : await buildMinutesDocx(data, options);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, await buffer);
  return outputPath;
}
