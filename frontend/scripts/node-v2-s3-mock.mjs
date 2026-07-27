import { createHash } from "node:crypto";
import http from "node:http";

const port = Number.parseInt(process.env.MANGORTS_NODE_V2_S3_PORT ?? "19090", 10);
const objects = new Map();

function cors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "*");
  response.setHeader("Access-Control-Expose-Headers", "ETag, x-amz-checksum-sha256, x-amz-server-side-encryption");
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, response) => {
  cors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  const key = decodeURIComponent(new URL(request.url ?? "/", `http://${request.headers.host}`).pathname);
  if (request.method === "PUT") {
    const body = await readBody(request);
    const checksum = String(request.headers["x-amz-checksum-sha256"] ?? createHash("sha256").update(body).digest("base64"));
    const etag = `"${createHash("md5").update(body).digest("hex")}"`;
    objects.set(key, { body, checksum, etag, contentType: String(request.headers["content-type"] ?? "application/octet-stream") });
    response.setHeader("ETag", etag);
    response.setHeader("x-amz-checksum-sha256", checksum);
    response.setHeader("x-amz-server-side-encryption", "AES256");
    response.writeHead(200).end();
    return;
  }

  const object = objects.get(key);
  if (!object) {
    response.setHeader("Content-Type", "application/xml");
    response.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
    return;
  }
  response.setHeader("Content-Type", object.contentType);
  response.setHeader("Content-Length", object.body.length);
  response.setHeader("ETag", object.etag);
  response.setHeader("x-amz-checksum-sha256", object.checksum);
  response.setHeader("x-amz-server-side-encryption", "AES256");
  if (request.method === "HEAD") {
    response.writeHead(200).end();
    return;
  }
  if (request.method === "GET") {
    response.writeHead(200).end(object.body);
    return;
  }
  if (request.method === "DELETE") {
    objects.delete(key);
    response.writeHead(204).end();
    return;
  }
  response.writeHead(501).end();
});

server.listen(port, "127.0.0.1", () => console.log(`Node v2 S3 mock listening on http://127.0.0.1:${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
