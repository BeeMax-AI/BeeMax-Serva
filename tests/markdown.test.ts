import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../shared/markdown.ts";
test("assistant replies render headings, emphasis, quotes, lists and status tables", () => {
  const html = renderMarkdown(
    "## 当前工单\n\n> 共 **2** 单\n\n|工单|状态|报单时间|\n|---|---|---|\n|G001|已接单|09/06 12:30|\n|G002|暂挂|09/06 13:10|\n\n- 查看 `G001`\n- 跟进 G002",
  );
  assert.match(html, /<h3>当前工单<\/h3>/);
  assert.match(html, /<strong>2<\/strong>/);
  assert.match(html, /<th scope="col">报单时间<\/th>/);
  assert.match(html, /<td>09\/06 12:30<\/td>/);
  assert.match(html, /<span class="chat-ticket-status">已接单<\/span>/);
  assert.match(html, /<ul><li>查看 <code>G001<\/code>/);
});
test("model HTML and script URLs remain inert text, including inside tables and code", () => {
  const html = renderMarkdown(
    "**<img src=x onerror=alert(1)>**\n\n[x](javascript:alert(1))\n\n|状态|内容|\n|---|---|\n|<svg onload=alert(1)>|<script>alert(1)</script>|\n\n```html\n</code><img src=x>\n```",
  );
  assert.ok(!/<(?:img|svg|script|a)\b/.test(html));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;\/code&gt;/);
});
test("plain lines, malformed tables and unclosed fences remain readable", () => {
  assert.match(renderMarkdown("第一行\n第二行"), /第一行<br>第二行/);
  assert.ok(!renderMarkdown("|一|二|\n|not a separator|").includes("<table>"));
  assert.match(
    renderMarkdown("```\na < b"),
    /<pre><code>a &lt; b<\/code><\/pre>/,
  );
});

test("oversized table shapes cannot amplify a short reply into unbounded DOM", () => {
  const text =
    "|" +
    Array(500).fill("列").join("|") +
    "|\n|" +
    Array(500).fill("---").join("|") +
    "|\n" +
    Array(1000).fill("|值|").join("\n");
  const html = renderMarkdown(text);
  assert.ok(html.length < 50000);
  assert.equal((html.match(/<td>/g) || []).length, 0);
  assert.match(html, /表格较大/);
  assert.match(html, /值/);
  const many = Array(30)
    .fill("|一|二|\n|---|---|\n" + Array(100).fill("|1|2|").join("\n"))
    .join("\n\n");
  assert.ok((renderMarkdown(many).match(/<td>/g) || []).length <= 2000);
});
