const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

loadEnv();

const SOCKET_URL = process.env.SOCKET_URL;
const SOCKET_TOKEN = process.env.SOCKET_TOKEN || process.env.TOKEN || "";
const SOCKET_TOKEN_PARAM = process.env.SOCKET_TOKEN_PARAM || "token";
const SOCKET_INCLUDE_TOKEN = process.env.SOCKET_INCLUDE_TOKEN === "1";
const SOCKET_LOG_FILE =
  process.env.SOCKET_LOG_FILE || path.join(process.cwd(), "logs", "socket-events.ndjson");
const SOCKET_RECONNECT_MS = parseNumber(process.env.SOCKET_RECONNECT_MS, 5000);
const SOCKET_HEARTBEAT_MS = parseNumber(process.env.SOCKET_HEARTBEAT_MS, 0);
const SOCKET_HEARTBEAT_MESSAGE = process.env.SOCKET_HEARTBEAT_MESSAGE || "";
const SOCKET_ON_OPEN = process.env.SOCKET_ON_OPEN || "";
const SOCKET_ALERT_MATCH = (process.env.SOCKET_ALERT_MATCH || "")
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean);

const LOCK_FILE = path.join(__dirname, ".socket-watch.lock");

let shouldStop = false;

function loadEnv() {
  const rootEnv = path.join(process.cwd(), ".env");
  const backendEnv = path.join(process.cwd(), "Backend", ".env");
  const options = { quiet: true };

  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv, ...options });
    return;
  }

  if (fs.existsSync(backendEnv)) {
    dotenv.config({ path: backendEnv, ...options });
    return;
  }

  dotenv.config(options);
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printStatus(message) {
  console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${message}`);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    if (!fs.existsSync(LOCK_FILE)) {
      return;
    }

    const current = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));

    if (current?.pid === process.pid) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // Verrou best-effort uniquement.
  }
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const current = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));

      if (current?.pid && current.pid !== process.pid && isProcessAlive(current.pid)) {
        throw new Error(
          `socket-watch est deja lance (PID ${current.pid}). Arrete l'autre terminal avant de relancer.`
        );
      }
    } catch (error) {
      if (error?.message?.includes("socket-watch est deja lance")) {
        throw error;
      }
    }
  }

  fs.writeFileSync(
    LOCK_FILE,
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

function ensureSocketConfig() {
  if (!SOCKET_URL) {
    fail("SOCKET_URL manquant dans .env");
  }
}

function buildSocketUrl() {
  const url = new URL(SOCKET_URL);

  if (SOCKET_INCLUDE_TOKEN && SOCKET_TOKEN) {
    url.searchParams.set(SOCKET_TOKEN_PARAM, SOCKET_TOKEN);
  }

  return url.toString();
}

function ensureLogDirectory() {
  fs.mkdirSync(path.dirname(SOCKET_LOG_FILE), { recursive: true });
}

function appendLog(entry) {
  ensureLogDirectory();
  fs.appendFileSync(SOCKET_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
}

function tryParseJson(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function dataToString(data) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof Buffer) {
    return data.toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }

  if (data && typeof data.text === "function") {
    return data.text();
  }

  return String(data ?? "");
}

function guessEventName(payload, raw) {
  if (payload && typeof payload === "object") {
    return (
      payload.type ||
      payload.event ||
      payload.name ||
      payload.topic ||
      payload.channel ||
      payload.action ||
      "message"
    );
  }

  return raw.length > 80 ? `${raw.slice(0, 77)}...` : raw || "message";
}

function matchesAlert(entry) {
  if (SOCKET_ALERT_MATCH.length === 0) {
    return false;
  }

  const haystack = JSON.stringify(entry).toLowerCase();
  return SOCKET_ALERT_MATCH.some((needle) => haystack.includes(needle.toLowerCase()));
}

function emitAlert(entry) {
  process.stdout.write("\u0007");
  printStatus(`ALERTE ${entry.eventName}`);
}

function sendIfConfigured(socket, rawMessage, label) {
  if (!rawMessage) {
    return;
  }

  socket.send(rawMessage);
  printStatus(`${label} envoye`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openSocketOnce() {
  const url = buildSocketUrl();
  const socket = new WebSocket(url);

  let heartbeatTimer = null;

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      printStatus(`Socket connecte sur ${url}`);
      sendIfConfigured(socket, SOCKET_ON_OPEN, "Message d'ouverture");

      if (SOCKET_HEARTBEAT_MS > 0 && SOCKET_HEARTBEAT_MESSAGE) {
        heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(SOCKET_HEARTBEAT_MESSAGE);
          }
        }, SOCKET_HEARTBEAT_MS);
      }
    });

    socket.addEventListener("message", async (event) => {
      const raw = await dataToString(event.data);
      const payload = tryParseJson(raw);
      const entry = {
        timestamp: new Date().toISOString(),
        eventName: guessEventName(payload, raw),
        raw,
        payload
      };

      appendLog(entry);
      printStatus(`EVENT ${entry.eventName}`);

      if (matchesAlert(entry)) {
        emitAlert(entry);
      }
    });

    socket.addEventListener("error", () => {
      printStatus("Erreur socket");
    });

    socket.addEventListener("close", (event) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      const reason = event.reason ? ` | raison ${event.reason}` : "";
      printStatus(`Socket fermee | code ${event.code}${reason}`);
      resolve();
    });

    if (shouldStop) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      try {
        socket.close();
      } catch {
        // Rien.
      }
      reject(new Error("Arret demande"));
    }
  });
}

async function main() {
  ensureSocketConfig();
  acquireLock();
  ensureLogDirectory();

  printStatus("Socket watch lance.");
  printStatus(`Log fichier: ${SOCKET_LOG_FILE}`);
  printStatus("Ctrl + C pour arreter.");

  while (!shouldStop) {
    try {
      await openSocketOnce();
    } catch (error) {
      if (shouldStop) {
        return;
      }

      printStatus(`Erreur de connexion: ${error.message}`);
    }

    if (shouldStop) {
      return;
    }

    printStatus(`Reconnexion dans ${Math.ceil(SOCKET_RECONNECT_MS / 1000)}s`);
    await sleep(SOCKET_RECONNECT_MS);
  }
}

process.on("exit", releaseLock);
process.on("SIGINT", () => {
  shouldStop = true;
  releaseLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shouldStop = true;
  releaseLock();
  process.exit(0);
});

main().catch((error) => {
  releaseLock();
  console.error(error.message);
  process.exit(1);
});
