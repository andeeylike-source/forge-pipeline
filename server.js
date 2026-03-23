const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── API: Check key
app.post("/api/check", async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ ok: false, error: "No key" });
  try {
    const r = await fetch("https://openrouter.ai/api/v1/auth/key", {
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
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: "openai/gpt-4o", max_tokens: 2000,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: "data:image/png;base64," + imageBase64 } },
        ]}],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Vision error" });
    return res.json({ text: data.choices?.[0]?.message?.content || "" });
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

    const body = { model: "openai/gpt-image-1", modalities: ["image"], messages };
    if (aspectRatio) body.image_config = { aspect_ratio: aspectRatio };

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Generate error" });

    const msg = data.choices?.[0]?.message;
    let imageUrl = null;
    if (msg?.content) {
      if (typeof msg.content === "string" && msg.content.startsWith("data:image")) imageUrl = msg.content;
      else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "image_url" && part.image_url?.url) { imageUrl = part.image_url.url; break; }
          if (part.type === "image" && part.image?.url) { imageUrl = part.image.url; break; }
        }
      }
    }
    if (!imageUrl) return res.status(500).json({ error: "No image in response" });
    return res.json({ imageUrl });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log("FORGE running on port " + PORT));
