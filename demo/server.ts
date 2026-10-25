/**
 * A small local demo: paste a request, get a proposed action, approve or reject it.
 *
 *   npm run demo                                   # mock provider, no API key
 *   INTENTFLOW_PROVIDER=anthropic npm run demo     # needs ANTHROPIC_API_KEY
 *   INTENTFLOW_PROVIDER=openai npm run demo        # needs OPENAI_API_KEY
 *
 * Executors here are simulated: approving returns a description of what would happen.
 * Nothing is sent, booked, or written anywhere.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ApprovalQueue, ProposalStateError, createIntentFlow, officeActions, providerFromName } from "../src/index.js";
import { simulatedExecutors } from "./simulated.js";

const provider = providerFromName(process.env.INTENTFLOW_PROVIDER);
const flow = createIntentFlow({ provider, actions: officeActions });
const queue = new ApprovalQueue({ actions: officeActions, executors: simulatedExecutors });

const page = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const MAX_BODY = 16 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Body must be a JSON object.");
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new HttpError(400, `"${field}" must be a string.`);
  return value;
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/info") {
      send(res, 200, { provider: provider.name, model: provider.model, actions: officeActions.map(({ name, description }) => ({ name, description })) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/proposals") {
      send(res, 200, queue.list().reverse());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/extract") {
      const input = text((await readJson(req)).input, "input");
      const extraction = await flow.extract(input);
      const proposal = extraction.kind === "action" ? queue.propose(extraction, { input, provider: provider.name, model: provider.model }) : undefined;
      send(res, 200, { extraction, proposal });
      return;
    }
    const match = /^\/api\/proposals\/([\w-]+)\/(approve|reject|edit)$/.exec(url.pathname);
    if (req.method === "POST" && match) {
      const [, id = "", decision] = match;
      const body = await readJson(req);
      const by = text(body.by, "by");
      if (decision === "approve") send(res, 200, await queue.approve(id, by));
      else if (decision === "reject") send(res, 200, queue.reject(id, by, typeof body.reason === "string" ? body.reason : undefined));
      else send(res, 200, queue.edit(id, (body.params ?? {}) as Record<string, unknown>, by));
      return;
    }
    send(res, 404, { error: "Not found." });
  } catch (error) {
    if (error instanceof HttpError) send(res, error.status, { error: error.message });
    else if (error instanceof ProposalStateError) send(res, 409, { error: error.message });
    else {
      console.error(error);
      send(res, 502, { error: error instanceof Error ? error.message : "The provider request failed." });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, "127.0.0.1", () => {
  console.log(`intentflow demo → http://localhost:${port}  (provider: ${provider.name}, model: ${provider.model})`);
});
