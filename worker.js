export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ========================================
    // 1. Worker自体の動作確認
    // ========================================
    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "Yuzuho Bridge",
        features: {
          x: true,
          masterAssets: true
        }
      });
    }

    // ========================================
    // 2. ChatGPT → Worker 認証
    // ========================================
    const workerKey = request.headers.get("X-Worker-Key");

    if (!env.WORKER_API_KEY || workerKey !== env.WORKER_API_KEY) {
      return json(
        {
          ok: false,
          error: "Unauthorized"
        },
        401
      );
    }

    // ========================================
    // 3. Xプロフィール取得
    // GET /x/me
    // ========================================
    if (url.pathname === "/x/me" && request.method === "GET") {
      if (!env.X_ACCESS_TOKEN) {
        return json(
          {
            ok: false,
            error: "X_ACCESS_TOKEN is not configured"
          },
          500
        );
      }

      const response = await fetch(
        "https://api.x.com/2/users/me?user.fields=profile_image_url,description,public_metrics",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${env.X_ACCESS_TOKEN}`
          }
        }
      );

      return proxyJson(response);
    }

    // ========================================
    // 4. Xへ投稿
    // POST /x/post
    // ========================================
    if (url.pathname === "/x/post" && request.method === "POST") {
      if (!env.X_ACCESS_TOKEN) {
        return json(
          {
            ok: false,
            error: "X_ACCESS_TOKEN is not configured"
          },
          500
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          {
            ok: false,
            error: "Invalid JSON"
          },
          400
        );
      }

      if (!body.text || typeof body.text !== "string") {
        return json(
          {
            ok: false,
            error: "text is required"
          },
          400
        );
      }

      const response = await fetch(
        "https://api.x.com/2/tweets",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.X_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: body.text
          })
        }
      );

      return proxyJson(response);
    }

    // ========================================
    // 5. MASTER一覧
    // GET /master/catalog
    // ========================================
    if (url.pathname === "/master/catalog" && request.method === "GET") {
      return json({
        ok: true,

        face: {
          front: "/master/face/front",
          right45: "/master/face/right45",
          left45: "/master/face/left45",
          down_angle: "/master/face/down_angle",
          smile: "/master/face/smile",
          back: "/master/face/back"
        },

        body: {
          front: "/master/body/front",
          angle45: "/master/body/angle45",
          side: "/master/body/side",
          back: "/master/body/back",
          back45: "/master/body/back45",
          relaxed: "/master/body/relaxed"
        }
      });
    }

    // ========================================
    // 6. MASTER自動選択
    //
    // POST /master/select
    //
    // 例:
    // {
    //   "angle": "front",
    //   "framing": "full_body",
    //   "expression": "neutral"
    // }
    // ========================================
    if (url.pathname === "/master/select" && request.method === "POST") {
      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          {
            ok: false,
            error: "Invalid JSON"
          },
          400
        );
      }

      const angle = normalize(body.angle || "front");
      const framing = normalize(body.framing || "upper_body");
      const expression = normalize(body.expression || "neutral");
      const pose = normalize(body.pose || "");

      const face = selectFaceMaster(angle, expression);
      const bodyMaster = selectBodyMaster(angle, framing, pose);

      const origin = url.origin;

      return json({
        ok: true,

        selection: {
          angle,
          framing,
          expression,

          face: {
            id: face,
            url: `${origin}/master/face/${face}`
          },

          body: bodyMaster
            ? {
                id: bodyMaster,
                url: `${origin}/master/body/${bodyMaster}`
              }
            : null
        },

        rule:
          "These files are Yuzuho identity reference masters. Preserve face, hair length, hair texture and body identity. Change only scene, outfit, pose, expression and camera composition."
      });
    }

    // ========================================
    // 7. FACE MASTER画像取得
    //
    // GET /master/face/front
    // GET /master/face/right45
    // 等
    // ========================================
    if (
      url.pathname.startsWith("/master/face/") &&
      request.method === "GET"
    ) {
      const id = url.pathname.split("/").pop();

      const faceFiles = {
        front: "/masters/face/front.png",
        right45: "/masters/face/right45.png",
        left45: "/masters/face/left45.png",
        down_angle: "/masters/face/down_angle.png",
        smile: "/masters/face/smile.png",
        back: "/masters/face/back.png"
      };

      const assetPath = faceFiles[id];

      if (!assetPath) {
        return json(
          {
            ok: false,
            error: "Unknown face master"
          },
          404
        );
      }

      return serveAsset(request, env, assetPath);
    }

    // ========================================
    // 8. BODY MASTER画像取得
    //
    // GET /master/body/front
    // GET /master/body/angle45
    // 等
    // ========================================
    if (
      url.pathname.startsWith("/master/body/") &&
      request.method === "GET"
    ) {
      const id = url.pathname.split("/").pop();

      const bodyFiles = {
        front: "/masters/body/front.png",
        angle45: "/masters/body/angle45.png",
        side: "/masters/body/side.png",
        back: "/masters/body/back.png",
        back45: "/masters/body/back45.png",
        relaxed: "/masters/body/relaxed.png"
      };

      const assetPath = bodyFiles[id];

      if (!assetPath) {
        return json(
          {
            ok: false,
            error: "Unknown body master"
          },
          404
        );
      }

      return serveAsset(request, env, assetPath);
    }

    // ========================================
    // 9. 存在しないURL
    // ========================================
    return json(
      {
        ok: false,
        error: "Not found"
      },
      404
    );
  }
};


// ==========================================
// FACE MASTER 自動選択
// ==========================================
function selectFaceMaster(angle, expression) {
  if (expression === "smile") {
    return "smile";
  }

  switch (angle) {
    case "right45":
    case "right_45":
      return "right45";

    case "left45":
    case "left_45":
      return "left45";

    case "down":
    case "down_angle":
      return "down_angle";

    case "back":
    case "rear":
      return "back";

    case "front":
    default:
      return "front";
  }
}


// ==========================================
// BODY MASTER 自動選択
// ==========================================
function selectBodyMaster(angle, framing, pose) {
  // 顔アップなら身体MASTERは不要
  if (
    framing === "closeup" ||
    framing === "close_up" ||
    framing === "face"
  ) {
    return null;
  }

  if (pose === "relaxed") {
    return "relaxed";
  }

  switch (angle) {
    case "back":
    case "rear":
      return "back";

    case "back45":
    case "back_45":
      return "back45";

    case "side":
    case "profile":
      return "side";

    case "right45":
    case "right_45":
    case "left45":
    case "left_45":
    case "angle45":
    case "angle_45":
      return "angle45";

    case "front":
    default:
      return "front";
  }
}


// ==========================================
// Cloudflare Static AssetsからMASTER取得
// ==========================================
async function serveAsset(request, env, assetPath) {
  if (!env.ASSETS) {
    return json(
      {
        ok: false,
        error: "ASSETS binding is not configured"
      },
      500
    );
  }

  const requestUrl = new URL(request.url);

  const assetUrl = new URL(
    assetPath,
    requestUrl.origin
  );

  const assetResponse = await env.ASSETS.fetch(
    new Request(assetUrl.toString(), {
      method: "GET"
    })
  );

  if (!assetResponse.ok) {
    return json(
      {
        ok: false,
        error: "Master image not found",
        path: assetPath
      },
      assetResponse.status
    );
  }

  const headers = new Headers(assetResponse.headers);

  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Yuzuho-Master", "true");

  return new Response(assetResponse.body, {
    status: assetResponse.status,
    headers
  });
}


// ==========================================
// 文字列正規化
// ==========================================
function normalize(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}


// ==========================================
// JSONレスポンス
// ==========================================
function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    }
  );
}


// ==========================================
// X APIレスポンスをそのまま返す
// ==========================================
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
