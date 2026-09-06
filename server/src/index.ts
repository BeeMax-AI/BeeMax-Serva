import { resolve } from "node:path";
import { Store } from "./store.ts";
import { createApp } from "./http.ts";
const host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 8766);
if (
  !["127.0.0.1", "localhost", "::1"].includes(host) &&
  (!process.env.APP_PUBLIC_URL?.startsWith("https://") ||
    process.env.SESSION_SECURE !== "true")
)
  throw new Error("非本机监听需要 HTTPS APP_PUBLIC_URL 和 SESSION_SECURE=true");
if (!["local", "mcp"].includes(process.env.DATA_PROVIDER || "local"))
  throw new Error("DATA_PROVIDER 必须是 local 或 mcp");
const store = new Store(resolve(process.env.DATA_DIR || ".local"));
store.initialize();
const { server, analysis } = createApp(store);
let ticking = false;
const tick = async () => {
  if (!analysis || ticking) return;
  ticking = true;
  try {
    await analysis.tick();
  } finally {
    ticking = false;
  }
};
server.listen(port, host, () =>
  console.log(
    `千蜂智服运行于 http://${host}:${port}；初始账号见 ${resolve(process.env.DATA_DIR || ".local", "access.json")}`,
  ),
);
const timer = setInterval(() => void tick(), 30000);
timer.unref();
void tick();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
