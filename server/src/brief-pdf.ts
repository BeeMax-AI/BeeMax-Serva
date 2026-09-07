import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statuses } from "../../shared/domain.ts";
import type { BriefData } from "./brief-data.ts";

// BeeMax production palette; rendered as vector graphics on A4 pages.
const C = {
  navy: "#0B1830",
  blue: "#178DFF",
  action: "#0072E0",
  muted: "#526073",
  line: "#DCDCDC",
  soft: "#F5F7F9",
  white: "#FFFFFF",
};
const LEFT = 40,
  WIDTH = 515;
export function renderBrief(data: BriefData, root: string): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      autoFirstPage: false,
      bufferPages: true,
      info: {
        Title: `${data.tenant} - 运营简报`,
        Author: "BeeMax Serva",
        Subject: `${data.start} - ${data.end}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      doc.registerFont(
        "CN",
        resolve(root, "server/assets/fonts/NotoSansCJKsc-Regular.otf"),
      );
      const logo = readFileSync(
        resolve(root, "design/gongdan-dashboard/assets/beemax-logo-mark.svg"),
        "utf8",
      );
      const clean = (value: unknown) =>
        String(value ?? "")
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .replace(/\p{Extended_Pictographic}|\uFE0F/gu, "");
      const text = (
        value: unknown,
        x: number,
        y: number,
        width: number,
        size = 10,
        color = C.navy,
        height = 40,
        numeric = false,
      ) => {
        doc
          .font(numeric ? "Helvetica" : "CN")
          .fontSize(size)
          .fillColor(color)
          .text(clean(value), x, y, {
            width,
            height,
            ellipsis: true,
            lineGap: 2,
          });
      };
      const line = (x: number, y: number, width: number, color = C.line) =>
        doc
          .save()
          .lineWidth(0.5)
          .strokeColor(color)
          .moveTo(x, y)
          .lineTo(x + width, y)
          .stroke()
          .restore();
      const section = (number: string, title: string, y: number, note = "") => {
        text(number, LEFT, y, 28, 10, C.action, 20, true);
        text(title, 70, y - 2, 320, 14, C.navy, 24);
        if (note) text(note, LEFT, y + 24, WIDTH, 8, C.muted, 22);
      };
      const stamp = new Date(Date.parse(data.generatedAt) + 28800000)
        .toISOString()
        .slice(0, 16)
        .replace("T", " ");
      const frame = (page: number, title: string, sub: string) => {
        doc.addPage();
        doc.rect(0, 0, 595.28, 5).fill(C.blue);
        SVGtoPDF(doc, logo, LEFT, 32, { width: 25, height: 28 });
        text("BeeMax Serva", 76, 34, 200, 14, C.navy, 23, true);
        text("AI 服务运营平台", 76, 54, 200, 8, C.muted, 18);
        text("OPERATIONS / BRIEF", 390, 40, 165, 9, C.action, 20, true);
        line(LEFT, 83, WIDTH);
        text(title, LEFT, 103, WIDTH, 27, C.navy, 45);
        text(sub, LEFT, 150, WIDTH, 10, C.muted, 28);
        line(LEFT, 785, WIDTH);
        text(`${data.tenant} · 内部运营资料`, LEFT, 798, 390, 8, C.muted, 18);
        text(
          `${String(page).padStart(2, "0")} / 02`,
          508,
          798,
          47,
          9,
          C.muted,
          18,
          true,
        );
      };
      frame(1, "运营简报", `${data.tenant}  |  ${data.start} - ${data.end}`);
      text(`生成于 ${stamp} · UTC+8`, LEFT, 181, WIDTH, 8, C.muted, 18);
      const kpis = [
        ["期间新建", String(data.created), "按创建日期"],
        ["期间闭环", String(data.closed), "可包含历史工单"],
        ["当前待闭环", String(data.open), "生成时的全部未闭环"],
        ["待接单 / 挂起", `${data.waiting} / ${data.held}`, "生成时的当前状态"],
      ];
      kpis.forEach(([label, value, note], i) => {
        const x = LEFT + i * 132;
        text(label, x, 222, 124, 9, C.muted, 20);
        text(value, x, 245, 124, 30, C.navy, 44, true);
        text(note, x, 291, 124, 7.5, C.muted, 18);
      });
      section(
        "01",
        "工单流转趋势",
        335,
        `期间净增 ${data.created - data.closed > 0 ? "+" : ""}${data.created - data.closed} 单 · 新建减闭环，非完成率`,
      );
      const x0 = 67,
        y0 = 535,
        cw = 466,
        ch = 135,
        max = Math.max(1, ...data.trend.flatMap((d) => [d.created, d.closed]));
      for (let i = 0; i <= 3; i++) {
        const y = y0 - (i * ch) / 3;
        line(x0, y, cw, C.line);
        text(Math.round((max * i) / 3), LEFT, y - 5, 24, 7, C.muted, 15, true);
      }
      const px = (i: number) =>
        data.trend.length === 1
          ? x0 + cw / 2
          : x0 + (i * cw) / (data.trend.length - 1);
      for (const key of ["created", "closed"] as const) {
        doc
          .save()
          .lineWidth(1.8)
          .strokeColor(key === "created" ? C.blue : C.navy);
        if (key === "closed") doc.dash(4, { space: 3 });
        data.trend.forEach((d, i) =>
          i
            ? doc.lineTo(px(i), y0 - (d[key] / max) * ch)
            : doc.moveTo(px(i), y0 - (d[key] / max) * ch),
        );
        doc.stroke().undash();
        data.trend.forEach((d, i) =>
          doc
            .circle(px(i), y0 - (d[key] / max) * ch, 2)
            .fillAndStroke(C.white, key === "created" ? C.blue : C.navy),
        );
        doc.restore();
      }
      data.trend.forEach((d, i) => {
        if (
          i === 0 ||
          i === data.trend.length - 1 ||
          i % Math.max(1, Math.ceil(data.trend.length / 6)) === 0
        )
          text(d.date.slice(5), px(i) - 16, 546, 40, 7, C.muted, 16, true);
      });
      line(390, 375, 15, C.blue);
      text("新建", 410, 369, 40, 8, C.muted, 18);
      doc.save().dash(3, { space: 2 });
      line(460, 375, 15, C.navy);
      doc.restore();
      text("闭环", 480, 369, 40, 8, C.muted, 18);
      section("02", "业务构成", 583);
      const bars = (
        rows: { name: string; value: number }[],
        x: number,
        label: string,
      ) => {
        text(label, x, 613, 245, 10, C.navy, 20);
        const shown = rows.slice(0, 4);
        if (rows.length > 4)
          shown.push({
            name: "其他",
            value: rows.slice(4).reduce((n, r) => n + r.value, 0),
          });
        if (!shown.length) {
          text("本期暂无记录", x, 646, 240, 10, C.muted, 25);
          return;
        }
        const maxValue = Math.max(1, ...shown.map((r) => r.value));
        shown.forEach((r, i) => {
          const y = 644 + i * 22;
          text(r.name, x, y - 5, 103, 8, C.muted, 16);
          doc.roundedRect(x + 107, y, 92, 4, 2).fill(C.soft);
          if (r.value)
            doc
              .roundedRect(x + 107, y, (92 * r.value) / maxValue, 4, 2)
              .fill(C.blue);
          text(r.value, x + 206, y - 6, 38, 9, C.navy, 18, true);
        });
      };
      bars(data.types, LEFT, "工单类型 / 单");
      bars(data.groups, 315, "负责小组 / 单");
      text(
        `基于已同步的 ${data.total} 条工单；未记录日期不代表实际业务量为零。`,
        LEFT,
        763,
        WIDTH,
        7,
        C.muted,
        16,
      );

      frame(
        2,
        "重点事项与团队负载",
        `当前状态快照 · ${stamp}  |  期间接单 ${data.start} - ${data.end}`,
      );
      section(
        "03",
        "优先关注工单",
        200,
        `共 ${data.attention.length} 单，展示前 ${Math.min(5, data.attention.length)} 单 · 升级、无人接单、待接单、挂起优先，同状态按创建时间排序`,
      );
      doc.rect(LEFT, 250, WIDTH, 25).fill(C.soft);
      text("工单 / 事项摘要", 50, 256, 300, 8, C.muted, 15);
      text("状态", 350, 256, 87, 8, C.muted, 15);
      text("负责人", 445, 256, 100, 8, C.muted, 15);
      data.attention.slice(0, 5).forEach((t, i) => {
        const y = 282 + i * 47;
        text(t.id, 50, y, 287, 8, C.action, 15);
        text(
          t.subject || `${t.type} · ${t.reference}`,
          50,
          y + 17,
          287,
          8.5,
          C.navy,
          25,
        );
        text(statuses[t.status], 350, y + 8, 88, 8, C.navy, 25);
        text(
          t.assigneeId
            ? data.names.get(t.assigneeId) || t.assigneeId
            : "待安排",
          445,
          y + 8,
          99,
          8,
          C.navy,
          25,
        );
        line(LEFT, y + 41, WIDTH);
      });
      if (!data.attention.length)
        text("当前没有升级、待接单或挂起工单。", 50, 300, 480, 11, C.muted, 30);
      section(
        "04",
        "人员负载",
        550,
        `展示前 ${Math.min(5, data.staff.length)} / ${data.staff.length} 位有接单或待办的人员 · 按当前待办、期间接单排序，不作为绩效排名`,
      );
      doc.rect(LEFT, 596, WIDTH, 25).fill(C.soft);
      text("人员", 50, 602, 145, 8, C.muted, 15);
      text("负责小组", 205, 602, 185, 8, C.muted, 15);
      text("期间接单", 399, 602, 70, 8, C.muted, 15);
      text("当前待办", 480, 602, 65, 8, C.muted, 15);
      data.staff.slice(0, 5).forEach((p, i) => {
        const y = 629 + i * 24;
        text(p.name, 50, y, 145, 8.5, C.navy, 19);
        text(p.group, 205, y, 180, 8, C.muted, 19);
        text(p.accepted, 415, y, 50, 10, C.navy, 19, true);
        text(p.open, 499, y, 45, 10, C.navy, 19, true);
        line(LEFT, y + 20, WIDTH);
      });
      if (!data.staff.length)
        text("暂无可展示的人员负载记录。", 50, 642, 480, 11, C.muted, 25);
      text(
        "时区 UTC+8。期间记录排除无效及未来时间；状态与人员待办取生成时快照。",
        LEFT,
        763,
        WIDTH,
        7,
        C.muted,
        16,
      );
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
