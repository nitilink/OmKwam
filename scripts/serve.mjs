import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const portArgIndex = process.argv.indexOf("--port");
const port = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 5173;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
]);

function resolveRequestPath(url = "/") {
  const parsedUrl = new URL(url, "http://127.0.0.1");
  const relativePath = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, "")) || "index.html";
  const filePath = path.resolve(root, relativePath);

  if (!filePath.toLowerCase().startsWith(root.toLowerCase())) {
    return null;
  }

  return filePath;
}

const server = createServer(async (request, response) => {
  try {
    let filePath = resolveRequestPath(request.url);
    if (!filePath) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    const fileStat = await stat(filePath).catch(() => null);
    if (fileStat?.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "content-length": body.length,
    });

    if (request.method === "HEAD") {
      response.end();
    } else {
      response.end(body);
    }
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OmKwam local server running at http://127.0.0.1:${port}/`);
  console.log(`Serving files from ${root}`);
  console.log("Press Ctrl+C to stop.");
});
