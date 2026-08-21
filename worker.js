export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 動作確認
    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "Yuzuho X Bridge",
        clientIdConfigured: !!env.X_CLIENT_ID,
        clientSecretConfigured: !!env.X_CLIENT_SECRET
      });
    }

    // X接続確認
    if (url.pathname === "/x/me" && request.method === "GET") {
      if (!env.X_ACCESS_TOKEN) {
        return json({
          ok: false,
          error: "X_ACCESS_TOKEN is not configured yet"
        }, 401);
      }

      const response = await fetch(
        "https://api.x.com/2/users/me?user.fields=profile_image_url,description,public_metrics",
        {
          headers: {
            Authorization: `Bearer ${env.X_ACCESS_TOKEN}`
          }
        }
      );

      return proxyJson(response);
    }

    // Xへ投稿
    if (url.pathname === "/x/post" && request.method === "POST") {
      if (!env.X_ACCESS_TOKEN) {
        return json({
          ok: false,
          error: "X_ACCESS_TOKEN is not configured yet"
        }, 401);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "Invalid JSON" }, 400);
      }

      if (!body.text || typeof body.text !== "string") {
        return json({
          ok: false,
          error: "text is required"
        }, 400);
      }

      const response = await fetch("https://api.x.com/2/tweets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.X_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: body.text
        })
      });

      return proxyJson(response);
    }

    return json({
      ok: false,
      error: "Not found"
    }, 404);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function proxyJson(response) {
  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") ||
        "application/json; charset=utf-8"
    }
  });
}
