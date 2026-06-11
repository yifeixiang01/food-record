const http = require("http");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const APP_PASSWORD = process.env.APP_PASSWORD || "250830";
const AUTH_SECRET = process.env.AUTH_SECRET || `food-records-${APP_PASSWORD}`;
const SESSION_COOKIE = "food_records_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const ROOT = __dirname;
const PWA_ROOT = path.join(ROOT, "pwa");
const DATA_FILE = path.join(ROOT, "data", "records.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

async function ensureDataFile() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (error) {
    await fs.writeFile(DATA_FILE, "[]", "utf8");
  }
}

async function readRecords() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  try {
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    return [];
  }
}

async function writeRecords(records) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index < 0) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function signPayload(payload) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
}

function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now() })).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return false;
  const [payload, signature] = token.split(".");
  const expected = signPayload(payload);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Date.now() - Number(data.iat || 0) < SESSION_MAX_AGE * 1000;
  } catch (error) {
    return false;
  }
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

function setSessionCookie(res) {
  const token = createSessionToken();
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeRecord(record) {
  return {
    id: record.id || `${Date.now()}`,
    date: record.date || "",
    meal: record.meal || "",
    mealTime: record.mealTime || "",
    foods: record.foods || {},
    measureTime: record.measureTime || "",
    glucose: record.glucose || "",
    exercise: record.exercise || ""
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/session" && req.method === "GET") {
    sendJson(res, 200, { authenticated: isAuthenticated(req) });
    return true;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const payload = body ? JSON.parse(body) : {};
    if (payload.password === APP_PASSWORD) {
      setSessionCookie(res);
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 401, { error: "Invalid password" });
    }
    return true;
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (!isAuthenticated(req)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return true;
  }

  if (url.pathname === "/api/records" && req.method === "GET") {
    const records = await readRecords();
    sendJson(res, 200, { records });
    return true;
  }

  if (url.pathname === "/api/records" && req.method === "POST") {
    const body = await readBody(req);
    const payload = body ? JSON.parse(body) : {};
    const record = normalizeRecord(payload);
    const records = await readRecords();
    const nextRecords = [record, ...records.filter((item) => item.id !== record.id)];
    await writeRecords(nextRecords);
    sendJson(res, 201, { record });
    return true;
  }

  if (url.pathname === "/api/records" && req.method === "DELETE") {
    await writeRecords([]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const deleteMatch = url.pathname.match(/^\/api\/records\/([^/]+)$/);
  if (deleteMatch && req.method === "DELETE") {
    const id = decodeURIComponent(deleteMatch[1]);
    const records = await readRecords();
    await writeRecords(records.filter((record) => record.id !== id));
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PWA_ROOT, requestPath));

  if (!filePath.startsWith(PWA_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(data);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: "Not found" });
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Food records PWA running at http://${HOST}:${PORT}`);
});
