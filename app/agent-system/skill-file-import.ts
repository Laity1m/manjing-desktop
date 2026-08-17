export interface ImportedSkillDocument {
  title: string;
  content: string;
  source: string;
  tags: string[];
}

const MAX_DOCUMENT_CHARS = 2_000_000;
const TEXT_EXTENSIONS = new Set(["skill", "md", "markdown", "txt", "json", "yaml", "yml"]);

export async function parseSkillFile(file: File): Promise<ImportedSkillDocument> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  let content = "";

  if (TEXT_EXTENSIONS.has(extension)) {
    content = await file.text();
    if (extension === "json") content = formatJsonSkill(content);
  } else if (extension === "docx") {
    content = await readDocx(file);
  } else if (extension === "pdf") {
    content = await readPdf(file);
  } else if (extension === "doc") {
    throw new Error(`${file.name} 是旧版 .doc 格式，请先另存为 .docx 后导入`);
  } else {
    throw new Error(`${file.name} 暂不支持，请使用 .skill、.md、.txt、.json、.yaml、.docx 或 .pdf`);
  }

  const clean = normalizeDocument(content).slice(0, MAX_DOCUMENT_CHARS);
  if (!clean) throw new Error(`${file.name} 没有提取到可读文字`);
  return {
    title: detectTitle(clean, file.name),
    content: clean,
    source: `用户导入 · ${file.name}`,
    tags: [extension.toUpperCase() || "FILE", "用户导入"],
  };
}

async function readDocx(file: File) {
  const mammothModule = await import("mammoth");
  const mammoth = mammothModule.default || mammothModule;
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value || "";
}

async function readPdf(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    const line = text.items.map((item) => "str" in item ? item.str : "").filter(Boolean).join(" ");
    if (line.trim()) pages.push(`【第 ${pageNumber} 页】\n${line.trim()}`);
  }
  return pages.join("\n\n");
}

function formatJsonSkill(content: string) {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    const name = String(value.name || value.title || value.skill || "").trim();
    const description = String(value.description || "").trim();
    const instructions = value.instructions || value.content || value.prompt || value.rules;
    const body = typeof instructions === "string" ? instructions : instructions ? JSON.stringify(instructions, null, 2) : JSON.stringify(value, null, 2);
    return [name ? `# ${name}` : "", description, body].filter(Boolean).join("\n\n");
  } catch {
    return content;
  }
}

function detectTitle(content: string, fileName: string) {
  const markdownTitle = content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  const labeledTitle = content.match(/^\s*(?:name|title|技能名称|名称)\s*[:：]\s*(.+)$/im)?.[1]?.trim();
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 2 && line.length <= 60);
  return (markdownTitle || labeledTitle || firstLine || fileName.replace(/\.[^.]+$/, "")).replace(/^[#*-]+\s*/, "").slice(0, 80);
}

function normalizeDocument(content: string) {
  return content.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}
