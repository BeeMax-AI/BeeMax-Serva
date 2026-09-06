/** Small, deliberately HTML-free Markdown renderer for model replies. */
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function inline(text: string): string {
  const tokens = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let html = "",
    start = 0;
  for (const match of text.matchAll(tokens)) {
    html += escape(text.slice(start, match.index));
    const value = match[0];
    html += value.startsWith("`")
      ? `<code>${escape(value.slice(1, -1))}</code>`
      : value.startsWith("**")
        ? `<strong>${escape(value.slice(2, -2))}</strong>`
        : `<em>${escape(value.slice(1, -1))}</em>`;
    start = match.index! + value.length;
  }
  return html + escape(text.slice(start));
}
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
const separator = (line: string) =>
  line.includes("|") && cells(line).every((c) => /^:?-{3,}:?$/.test(c));
const knownStates = new Set([
  "已派单",
  "已接单",
  "待接单",
  "未接单",
  "暂挂",
  "挂起",
  "已挂起",
  "处理中",
  "待处理",
  "未关闭",
  "已关闭",
  "已闭环",
  "已完成",
  "已升级 L2",
  "已升级 L3",
  "已升级 L4",
]);
export function renderMarkdown(text: string): string {
  const lines = text.slice(0, 32000).replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let tableCells = 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]))
        code.push(lines[i++]);
      if (i < lines.length) i++;
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (i + 1 < lines.length && line.includes("|") && separator(lines[i + 1])) {
      const headers = cells(line);
      let end = i + 2;
      while (
        end < lines.length &&
        lines[end].trim() &&
        lines[end].includes("|")
      )
        end++;
      const count = (end - i - 2) * headers.length;
      if (headers.length > 24 || tableCells + count > 2000) {
        out.push(
          `<p>表格较大，以下按原文显示。</p><pre><code>${escape(lines.slice(i, end).join("\n"))}</code></pre>`,
        );
        i = end;
        continue;
      }
      tableCells += count;
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const row = cells(lines[i++]);
        rows.push(
          `<tr>${headers
            .map((h, j) => {
              const value = row[j] || "",
                plain = value.replace(/^\*\*|\*\*$/g, "");
              return `<td>${/状态/.test(h) && knownStates.has(plain) ? `<span class="chat-ticket-status">${escape(plain)}</span>` : inline(value)}</td>`;
            })
            .join("")}</tr>`,
        );
      }
      out.push(
        `<div class="chat-table-scroll" tabindex="0" role="region" aria-label="回复中的数据表格"><table><thead><tr>${headers.map((h) => `<th scope="col">${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
      );
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        quote.push(inline(lines[i++].replace(/^\s*>\s?/, "")));
      out.push(`<blockquote>${quote.join("<br>")}</blockquote>`);
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+/.test(line),
      unordered = /^\s*[-*+]\s+/.test(line);
    if (ordered || unordered) {
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/,
        items: string[] = [];
      while (i < lines.length && pattern.test(lines[i]))
        items.push(`<li>${inline(lines[i++].replace(pattern, ""))}</li>`);
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const paragraph = [inline(line)];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(?:#|>|```|[-*+]\s|\d+[.)]\s|---)/.test(lines[i]) &&
      !(i + 1 < lines.length && separator(lines[i + 1]))
    )
      paragraph.push(inline(lines[i++]));
    out.push(`<p>${paragraph.join("<br>")}</p>`);
  }
  return out.join("");
}
