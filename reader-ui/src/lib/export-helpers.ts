import JSZip from "jszip";
import {
  extractImageUrls,
  htmlToMarkdown,
  slugifyFilename,
} from "./html-utils";
import type { MinifluxEntry } from "./miniflux";

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("169.254.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function downloadImageBuffer(
  url: string
): Promise<{ data: Uint8Array; ext: string; contentType: string } | null> {
  if (!isAllowedExternalUrl(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 20 * 1024 * 1024) {
      return null;
    }

    let ext = "jpg";
    if (contentType.includes("png")) ext = "png";
    else if (contentType.includes("webp")) ext = "webp";
    else if (contentType.includes("gif")) ext = "gif";
    else if (contentType.includes("svg")) ext = "svg";
    else {
      const m = url.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i);
      if (m) ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
    }

    return { data: buf, ext, contentType };
  } catch {
    return null;
  }
}

function escapeCsvCell(val: string | number | boolean): string {
  const s = String(val ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escapeYaml(val: string): string {
  return `"${(val || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function buildEntriesExportZip(
  entries: MinifluxEntry[]
): Promise<Uint8Array> {
  const zip = new JSZip();
  const imagesFolder = zip.folder("images")!;
  const csvRows: string[] = [
    "id,title,source,folder,url,published_at,starred,markdown_file,images_count",
  ];

  // Giới hạn tải song song để không làm nghẽn mạng nhà
  const concurrency = 6;
  for (const entry of entries) {
    const imgUrls = extractImageUrls(entry.content || "", entry.enclosures).slice(0, 30);
    const rewriteMap = new Map<string, string>();
    let savedImages = 0;

    for (let i = 0; i < imgUrls.length; i += concurrency) {
      const chunk = imgUrls.slice(i, i + concurrency);
      const results = await Promise.all(
        chunk.map(async (url, idx) => ({
          url,
          num: i + idx + 1,
          dl: await downloadImageBuffer(url),
        }))
      );
      for (const item of results) {
        if (!item.dl) continue;
        const imgFilename = `${entry.id}_${item.num}.${item.dl.ext}`;
        imagesFolder.file(imgFilename, item.dl.data);
        rewriteMap.set(item.url, `images/${imgFilename}`);
        savedImages += 1;
      }
    }

    const mdBody = htmlToMarkdown(entry.content || "", rewriteMap);
    const sourceName = entry.feed?.title || "";
    const folderName = entry.feed?.category?.title || "";
    const mdFilename = `${slugifyFilename(entry.title, "bai-viet")}-${entry.id}.md`;

    const frontmatter = [
      "---",
      `id: ${entry.id}`,
      `title: ${escapeYaml(entry.title)}`,
      `source: ${escapeYaml(sourceName)}`,
      `folder: ${escapeYaml(folderName)}`,
      `url: ${escapeYaml(entry.url)}`,
      `published_at: ${escapeYaml(entry.published_at)}`,
      `starred: ${entry.starred ? "true" : "false"}`,
      `images_count: ${savedImages}`,
      "---",
      "",
    ].join("\n");

    const fileContent = `${frontmatter}# ${entry.title}\n\n> Nguồn: ${sourceName} · [Bài gốc](${entry.url})\n\n${mdBody}\n`;
    zip.file(mdFilename, fileContent);

    csvRows.push(
      [
        escapeCsvCell(entry.id),
        escapeCsvCell(entry.title),
        escapeCsvCell(sourceName),
        escapeCsvCell(folderName),
        escapeCsvCell(entry.url),
        escapeCsvCell(entry.published_at),
        escapeCsvCell(entry.starred ? "true" : "false"),
        escapeCsvCell(mdFilename),
        escapeCsvCell(savedImages),
      ].join(",")
    );
  }

  // Thêm UTF-8 BOM để Excel mở tiếng Việt không bị lỗi font
  const csvWithBom = "\uFEFF" + csvRows.join("\n");
  zip.file("index.csv", csvWithBom);

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
