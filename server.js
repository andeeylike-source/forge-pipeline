const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_HTTP_REFERER = process.env.OPENROUTER_HTTP_REFERER || "https://forge-pipeline-1.onrender.com";
const OPENROUTER_APP_TITLE = process.env.OPENROUTER_APP_TITLE || "FORGE Pipeline";
const DEFAULT_VISION_MODELS = "google/gemini-2.5-flash-lite,google/gemini-2.0-flash-001";
const DEFAULT_IMAGE_MODELS = "google/gemini-2.0-flash-preview-image-generation,google/gemini-2.5-flash-image-preview";
const VISION_MODELS = (process.env.OPENROUTER_VISION_MODELS || process.env.OPENROUTER_VISION_MODEL || DEFAULT_VISION_MODELS)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const IMAGE_MODELS = (process.env.OPENROUTER_IMAGE_MODELS || process.env.OPENROUTER_IMAGE_MODEL || DEFAULT_IMAGE_MODELS)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

function openRouterHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": OPENROUTER_HTTP_REFERER,
    "X-Title": OPENROUTER_APP_TITLE,
  };
}

function normalizeTextContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      if (part?.type === "output_text") return part.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractImageUrl(message) {
  if (!message) return null;

  const tryValue = (value) => {
    if (!value) return null;
    if (typeof value === "string" && value.startsWith("data:image")) return value;
    if (typeof value === "string" && value.startsWith("http")) return value;
    return null;
  };

  if (tryValue(message.content)) return message.content;

  if (!Array.isArray(message.content)) return null;

  for (const part of message.content) {
    const fromPart =
      tryValue(part?.image_url?.url) ||
      tryValue(part?.image?.url) ||
      tryValue(part?.file?.url) ||
      tryValue(part?.url) ||
      tryValue(part?.source?.url) ||
      tryValue(part?.data);

    if (fromPart) return fromPart;
  }

  return null;
}

function shouldTryNextModel(errorMessage) {
  const msg = String(errorMessage || "").toLowerCase();
  return msg.includes("no endpoints found") || msg.includes("no provider") || msg.includes("not a valid model") || msg.includes("model not found");
}

async function fetchOpenRouterJson(apiKey, body, fallbackModels) {
  let lastError = null;

  for (const model of fallbackModels) {
    const r = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({ ...body, model }),
    });

    const data = await r.json();
    if (r.ok) return { data, model };

    const errorMessage = data.error?.message || `OpenRouter error (${r.status})`;
    lastError = new Error(errorMessage);
    if (!shouldTryNextModel(errorMessage) || model === fallbackModels[fallbackModels.length - 1]) {
      throw lastError;
    }
  }

  throw lastError || new Error("No OpenRouter models configured");
}

// ── API: Check key
app.post("/api/check", async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ ok: false, error: "No key" });
  try {
    const r = await fetch(`${OPENROUTER_BASE_URL}/auth/key`, {
      headers: { Authorization: "Bearer " + apiKey },
    });
    const data = await r.json();
    if (r.ok) return res.json({ ok: true, data: data.data || {} });
    return res.status(r.status).json({ ok: false, error: data.error?.message || "Invalid" });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// ── API: Vision analysis
app.post("/api/vision", async (req, res) => {
  const { apiKey, prompt, imageBase64 } = req.body;
  if (!apiKey || !prompt || !imageBase64) return res.status(400).json({ error: "Missing fields" });
  try {
    const body = {
      max_tokens: 2000,
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: "data:image/png;base64," + imageBase64 } },
      ]}],
    };
    const { data, model } = await fetchOpenRouterJson(apiKey, body, VISION_MODELS);
    return res.json({ text: normalizeTextContent(data.choices?.[0]?.message?.content), model });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── API: Image generation
app.post("/api/generate", async (req, res) => {
  const { apiKey, prompt, imageBase64, aspectRatio } = req.body;
  if (!apiKey || !prompt) return res.status(400).json({ error: "Missing fields" });
  try {
    const messages = [{ role: "user", content: [] }];
    if (imageBase64) messages[0].content.push({ type: "image_url", image_url: { url: "data:image/png;base64," + imageBase64 } });
    messages[0].content.push({ type: "text", text: prompt });

    const body = { modalities: ["image", "text"], messages };
    if (aspectRatio) body.image_config = { aspect_ratio: aspectRatio };

    const { data, model } = await fetchOpenRouterJson(apiKey, body, IMAGE_MODELS);
    const imageUrl = extractImageUrl(data.choices?.[0]?.message);
    if (!imageUrl) return res.status(500).json({ error: "No image in response" });
    return res.json({ imageUrl, model });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log("FORGE running on port " + PORT));
