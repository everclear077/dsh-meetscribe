import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Document, Packer, Paragraph, TextRun } from "docx";
import {
  MinutesValidationError,
  applyMinutesTemplate,
  buildMinutesDocx,
  buildMinutesJson,
  buildMinutesPrompt,
  generateMinutesDocx,
  parseMinutesJson,
  sanitizeLlmJsonResponse,
  validateMinutes,
  validateMinutesTemplate,
} from "../lib/word/index.js";

function completeMinutes() {
  return {
    metadata: {
      name: "产品周会",
      topic: "版本验收",
      date: "2026-11-19",
      startTime: "14:00",
      endTime: "15:00",
      location: "3 层会议室",
      format: "混合",
      host: "李敏",
      recorder: "陈晨",
      attendees: ["李敏", "陈晨"],
      absentees: [],
      project: "MeetScribe",
      confidentiality: "内部",
    },
    agenda: ["核对验收结果"],
    discussion: [
      {
        topic: "验收进度",
        content: "常规回归已经完成。",
        keyPoints: ["驱动切换问题仍需复现。"],
        sourceSegmentIds: ["seg-014", "seg-018"],
      },
    ],
    decisions: [{ content: "维持现有灰度范围。", sourceSegmentIds: ["seg-052"] }],
    actionItems: [
      {
        task: "整理异常日志",
        owner: null,
        collaborators: [],
        due: null,
        status: null,
        notes: null,
        sourceSegmentIds: ["seg-066"],
      },
    ],
    openIssues: [{ issue: "异常是否与特定声卡有关仍待确认。", sourceSegmentIds: ["seg-089"] }],
    nextMeeting: null,
  };
}

function documentXml(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  assert.ok(files["word/document.xml"], "DOCX 应包含 word/document.xml");
  return { files, xml: strFromU8(files["word/document.xml"]) };
}

test("提取带代码围栏和前后说明的 JSON，并保留来源 segmentId", () => {
  const raw = completeMinutes();
  const response = `以下是整理结果：\n\`\`\`json\n${JSON.stringify(raw)}\n\`\`\`\n请查收。`;
  assert.equal(sanitizeLlmJsonResponse(response), JSON.stringify(raw));
  const minutes = parseMinutesJson(response);
  assert.deepEqual(minutes.discussion[0].sourceSegmentIds, ["seg-014", "seg-018"]);
  assert.deepEqual(minutes.decisions[0].sourceSegmentIds, ["seg-052"]);
  assert.deepEqual(minutes.actionItems[0].sourceSegmentIds, ["seg-066"]);
  assert.deepEqual(parseMinutesJson(buildMinutesJson(minutes)), minutes);
});

test("未知元数据、负责人和期限使用明确的待补充或待确认值", () => {
  const minutes = parseMinutesJson(
    JSON.stringify({
      metadata: {
        name: null,
        topic: "unknown",
        location: "",
        format: null,
        host: undefined,
      },
      actionItems: [{ task: "补充测试记录", owner: null, due: "N/A" }],
      nextMeeting: {},
    }),
  );
  assert.equal(minutes.metadata.name, "待补充");
  assert.equal(minutes.metadata.topic, "待补充");
  assert.equal(minutes.metadata.location, "待补充");
  assert.equal(minutes.metadata.format, "待补充");
  assert.equal(minutes.metadata.host, "待补充");
  assert.equal(minutes.actionItems[0].owner, "待确认");
  assert.equal(minutes.actionItems[0].due, "待确认");
  assert.equal(minutes.actionItems[0].status, "待确认");
  assert.equal(minutes.nextMeeting, null);
});

test("schema 校验返回精确路径和有用错误", () => {
  const result = validateMinutes({
    metadata: { format: "电话" },
    actionItems: [{ task: "", owner: 42 }],
    extra: true,
  });
  assert.equal(result.success, false);
  if (result.success) return;
  const paths = result.errors.map((issue) => issue.path);
  assert.ok(paths.includes("$.metadata.format"));
  assert.ok(paths.includes("$.actionItems[0].task"));
  assert.ok(paths.includes("$.actionItems[0].owner"));
  assert.ok(paths.includes("$.extra"));
  assert.throws(
    () => parseMinutesJson(JSON.stringify({ metadata: {}, actionItems: [{ task: "" }] })),
    (error) => {
      assert.ok(error instanceof MinutesValidationError);
      assert.match(error.message, /\$\.actionItems\[0\]\.task/);
      return true;
    },
  );
  assert.throws(() => parseMinutesJson("```json\n{not-json}\n```"), /不是有效 JSON/);
});

test("中文提示词强调事实约束、未知值、来源和去套话", () => {
  const prompt = buildMinutesPrompt("seg-01：维持灰度。", { name: "产品周会" });
  assert.match(prompt, /不得猜测/);
  assert.match(prompt, /待补充/);
  assert.match(prompt, /待确认/);
  assert.match(prompt, /sourceSegmentIds/);
  assert.match(prompt, /不要输出 Markdown/);
  assert.match(prompt, /丰硕成果/);
  assert.match(prompt, /产品周会/);
  assert.throws(() => buildMinutesPrompt("  "), /非空逐字稿/);
});

test("空可选章节不进入 DOCX，项目符号使用 Word numbering", async () => {
  const minutes = parseMinutesJson(
    JSON.stringify({ metadata: { name: "短会", format: "线上" }, agenda: ["唯一议题"] }),
  );
  const buffer = await buildMinutesDocx(minutes);
  const { files, xml } = documentXml(buffer);
  assert.ok(xml.includes("短会会议纪要"));
  assert.ok(xml.includes("唯一议题"));
  assert.ok(!xml.includes("讨论要点"));
  assert.ok(!xml.includes("议定事项"));
  assert.ok(!xml.includes("任务分工"));
  assert.ok(!xml.includes("待核实事项"));
  assert.ok(!xml.includes("下次会议安排"));
  assert.ok(!xml.includes(">•<"), "正文 run 不应包含字面项目符号");
  const numbering = strFromU8(files["word/numbering.xml"]);
  assert.ok(numbering.includes('w:val="bullet"'));
});

test("生成原生 DOCX 文件、ZIP 签名、固定表格和页码域", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "meetscribe-word-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "nested", "minutes.docx");
  const returnedPath = await generateMinutesDocx(parseMinutesJson(JSON.stringify(completeMinutes())), outputPath);
  assert.equal(returnedPath, outputPath);

  const bytes = await readFile(outputPath);
  assert.equal(bytes.subarray(0, 4).toString("hex"), "504b0304");
  const { files, xml } = documentXml(bytes);
  assert.ok(xml.includes("任务分工"));
  assert.ok(xml.includes("待确认"));
  assert.ok(xml.includes("<w:tblHeader/>"), "任务表头应跨页重复");
  assert.ok(xml.includes('w:w="8732"'), "表格应使用固定 DXA 正文宽度");
  assert.ok(xml.includes('w:val="dxa"') || xml.includes('w:type="dxa"'));
  assert.ok(xml.includes('w:w="11906"'));
  assert.ok(xml.includes('w:h="16838"'));

  const footerXml = Object.entries(files)
    .filter(([path]) => /^word\/footer\d+\.xml$/.test(path))
    .map(([, content]) => strFromU8(content))
    .join("");
  assert.ok(footerXml.includes("PAGE"));
  assert.ok(footerXml.includes("NUMPAGES"));
});

async function syntheticTemplate() {
  return Packer.toBuffer(new Document({
    creator: "Synthetic Template",
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        new Paragraph({ children: [new TextRun("{{MEETING"), new TextRun("_NAME}}"), new TextRun("（自定义）")] }),
        new Paragraph({ children: [new TextRun("日期：{{MEETING_DATE}}")] }),
        new Paragraph({ children: [new TextRun("{{MEETSCRIBE_"), new TextRun("BODY}}")] }),
      ],
    }],
  }));
}

test("自定义 DOCX 模板保留页面设置、替换跨 run 标记并合并正文样式与编号", async () => {
  const template = await syntheticTemplate();
  await validateMinutesTemplate(template);
  const output = await applyMinutesTemplate(parseMinutesJson(JSON.stringify(completeMinutes())), template);
  const { files, xml } = documentXml(output);
  assert.ok(xml.includes("产品周会（自定义）"));
  assert.ok(xml.includes("日期：2026-11-19"));
  assert.ok(xml.includes("议定事项"));
  assert.ok(xml.includes("任务分工"));
  assert.ok(!xml.includes("MEETSCRIBE"));
  assert.ok(!xml.includes("MEETING_NAME"));
  assert.ok(xml.includes('w:val="MeetScribeHeading1"'));
  assert.ok(xml.includes('w:top="1440"'), "模板页边距应保留");
  assert.ok(!xml.includes("短会会议纪要"), "自定义正文不能重复内置封面");
  const styles = strFromU8(files["word/styles.xml"]);
  assert.ok(styles.includes('w:styleId="MeetScribeHeading1"'));
  const numbering = strFromU8(files["word/numbering.xml"]);
  const defined = new Set([...numbering.matchAll(/<w:num\b[^>]*\bw:numId="(\d+)"/g)].map((match) => match[1]));
  for (const match of xml.matchAll(/<w:numId\b[^>]*\bw:val="(\d+)"/g)) {
    assert.ok(defined.has(match[1]), `正文编号 ${match[1]} 必须在模板 numbering.xml 中有定义`);
  }
});

test("模板校验拒绝缺失内容标记、宏、外部关系和 ZIP 路径穿越", async () => {
  const template = await syntheticTemplate();
  const files = unzipSync(new Uint8Array(template));
  const withoutMarker = { ...files, "word/document.xml": strToU8(strFromU8(files["word/document.xml"]).replace("{{MEETSCRIBE_", "").replace("BODY}}", "")) };
  await assert.rejects(validateMinutesTemplate(zipSync(withoutMarker)), /MEETSCRIBE_BODY/);
  await assert.rejects(validateMinutesTemplate(zipSync({ ...files, "word/vbaProject.bin": new Uint8Array([1]) })), /宏|嵌入/);
  const external = strFromU8(files["_rels/.rels"]).replace("</Relationships>", '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/>');
  await assert.rejects(validateMinutesTemplate(zipSync({ ...files, "_rels/.rels": strToU8(external) })), /外部/);
  const auxiliaryExternal = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>';
  await assert.rejects(validateMinutesTemplate(zipSync({ ...files, "word/_rels/footnotes.xml.rels": strToU8(auxiliaryExternal) })), /外部/);
  const dynamicField = strFromU8(files["word/document.xml"]).replace("</w:body>", '<w:p><w:fldSimple w:instr=" DDEAUTO excel \\\\example.invalid\\sheet "><w:r><w:t>external</w:t></w:r></w:fldSimple></w:p></w:body>');
  await assert.rejects(validateMinutesTemplate(zipSync({ ...files, "word/document.xml": strToU8(dynamicField) })), /DDE|外部/);
  const duplicatedMarker = strFromU8(files["word/document.xml"]).replace("</w:body>", "<w:p><w:r><w:t>{{MEETSCRIBE_BODY}}</w:t></w:r></w:p></w:body>");
  await assert.rejects(validateMinutesTemplate(zipSync({ ...files, "word/document.xml": strToU8(duplicatedMarker) })), /只放置一个/);
  await assert.rejects(validateMinutesTemplate(zipSync({ ...files, "../escape.txt": strToU8("no") })), /不安全路径/);
});
