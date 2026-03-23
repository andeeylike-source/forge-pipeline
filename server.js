const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_HTTP_REFERER = process.env.OPENROUTER_HTTP_REFERER || "https://forge-pipeline-1.onrender.com";
const OPENROUTER_APP_TITLE = process.env.OPENROUTER_APP_TITLE || "FORGE Pipeline";
const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || "google/gemini-2.5-flash-lite";
const IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-2.5-flash-image-preview";

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
    const r = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: "data:image/png;base64," + imageBase64 } },
        ]}],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Vision error" });
    return res.json({ text: normalizeTextContent(data.choices?.[0]?.message?.content) });
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

    const body = { model: IMAGE_MODEL, modalities: ["image", "text"], messages };
    if (aspectRatio) body.image_config = { aspect_ratio: aspectRatio };

    const r = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Generate error" });

    const imageUrl = extractImageUrl(data.choices?.[0]?.message);
    if (!imageUrl) return res.status(500).json({ error: "No image in response" });
    return res.json({ imageUrl });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log("FORGE running on port " + PORT));
