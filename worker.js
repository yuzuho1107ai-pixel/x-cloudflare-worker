export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ========================================
    // 1. Worker動作確認
    // ========================================
    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "Yuzuho Bridge",
        features: {
          x: true,
          masterAssets: true,
          publicMasterAssets: true
        }
      });
    }


    // ========================================
    // 2. PUBLIC MASTER
    //
    // ここだけ認証なし。
    // Custom GPT / 画像生成側から直接参照するため。
    //
    // FACE:
    // /master-public/face/front.png
    // /master-public/face/right45.png
    // ...
    //
    // BODY:
    // /master-public/body/front.png
    // /master-public/body/angle45.png
    // ...
    // ========================================
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/master-public/")
    ) {
      if (!env.ASSETS) {
        return json(
          {
            ok: false,
            error: "ASSETS binding is not configured"
          },
          500
        );
      }

      const match = url.pathname.match(
        /^\/master-public\/(face|body)\/([a-zA-Z0-9_-]+)\.png$/
      );

      if (!match) {
        return json(
          {
            ok: false,
            error: "Invalid MASTER URL"
          },
          400
        );
      }

      const type = match[1];
      const masterId = match[2];

      const allowedFace = [
        "front",
        "right45",
        "left45",
        "down_angle",
        "smile",
        "back"
      ];

      const allowedBody = [
        "front",
        "angle45",
        "side",
        "back",
        "back45",
        "relaxed"
      ];

      const allowed =
        type === "face" ? allowedFace : allowedBody;

      if (!allowed.includes(masterId)) {
        return json(
          {
            ok: false,
            error: "Unknown MASTER"
          },
          404
        );
      }

      // public/masters/... をCloudflare Assetsから取得
      const assetUrl = new URL(request.url);
      assetUrl.pathname = `/masters/${type}/${masterId}.png`;
      assetUrl.search = "";

      const assetRequest = new Request(
        assetUrl.toString(),
        {
          method: "GET",
          headers: request.headers
        }
      );

      const response = await env.ASSETS.fetch(assetRequest);

      if (!response.ok) {
        return json(
          {
            ok: false,
            error: "MASTER asset not found",
            type,
            masterId,
            status: response.status
          },
          404
        );
      }

      const headers = new Headers(response.headers);

      headers.set("Content-Type", "image/png");

      // MASTER自体は変更頻度が低いためキャッシュ
      headers.set(
        "Cache-Control",
        "public, max-age=3600"
      );

      return new Response(response.body, {
        status: 200,
        headers
      });
    }


    // ========================================
    // 3. ここから下は認証必須
    // ========================================
    const workerKey =
      request.headers.get("X-Worker-Key");

    if (
      !env.WORKER_API_KEY ||
      workerKey !== env.WORKER_API_KEY
    ) {
      return json(
        {
          ok: false,
          error: "Unauthorized"
        },
        401
      );
    }


    // ========================================
    // 4. Xプロフィール取得
    // GET /x/me
    // ========================================
    if (
      url.pathname === "/x/me" &&
      request.method === "GET"
    ) {
      if (!env.X_ACCESS_TOKEN) {
        return json(
          {
            ok: false,
            error:
              "X_ACCESS_TOKEN is not configured"
          },
          500
        );
      }

      const response = await fetch(
        "https://api.x.com/2/users/me?user.fields=profile_image_url,description,public_metrics",
        {
          method: "GET",
          headers: {
            Authorization:
              `Bearer ${env.X_ACCESS_TOKEN}`
          }
        }
      );

      return proxyJson(response);
    }


    // ========================================
    // 5. Xへ投稿
    // POST /x/post
    // ========================================
    if (
      url.pathname === "/x/post" &&
      request.method === "POST"
    ) {
      if (!env.X_ACCESS_TOKEN) {
        return json(
          {
            ok: false,
            error:
              "X_ACCESS_TOKEN is not configured"
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

      if (
        !body.text ||
        typeof body.text !== "string"
      ) {
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
            Authorization:
              `Bearer ${env.X_ACCESS_TOKEN}`,
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            text: body.text
          })
        }
      );

      return proxyJson(response);
    }


    // ========================================
    // 6. MASTERカタログ
    // GET /master/catalog
    // ========================================
    if (
      url.pathname === "/master/catalog" &&
      request.method === "GET"
    ) {
      const origin = url.origin;

      return json({
        ok: true,

        face: [
          "front",
          "right45",
          "left45",
          "down_angle",
          "smile",
          "back"
        ],

        body: [
          "front",
          "angle45",
          "side",
          "back",
          "back45",
          "relaxed"
        ],

        publicBaseUrl:
          `${origin}/master-public`
      });
    }


    // ========================================
    // 7. MASTER自動選択
    // POST /master/select
    // ========================================
    if (
      url.pathname === "/master/select" &&
      request.method === "POST"
    ) {
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

      const angle =
        typeof body.angle === "string"
          ? body.angle
          : "front";

      const framing =
        typeof body.framing === "string"
          ? body.framing
          : "upper_body";

      const expression =
        typeof body.expression === "string"
          ? body.expression
          : "neutral";

      const pose =
        typeof body.pose === "string"
          ? body.pose
          : "normal";


      // --------------------------------------
      // FACE MASTER選択
      // --------------------------------------
      let faceMaster = "front";

      if (expression === "smile") {
        faceMaster = "smile";
      } else {
        switch (angle) {
          case "right45":
            faceMaster = "right45";
            break;

          case "left45":
            faceMaster = "left45";
            break;

          case "down_angle":
            faceMaster = "down_angle";
            break;

          case "back":
            faceMaster = "back";
            break;

          default:
            faceMaster = "front";
        }
      }


      // --------------------------------------
      // BODY MASTER選択
      // --------------------------------------
      let bodyMaster = "front";

      if (pose === "relaxed") {
        bodyMaster = "relaxed";
      } else {
        switch (angle) {
          case "right45":
          case "left45":
          case "down_angle":
            bodyMaster = "angle45";
            break;

          case "side":
            bodyMaster = "side";
            break;

          case "back45":
            bodyMaster = "back45";
            break;

          case "back":
            bodyMaster = "back";
            break;

          default:
            bodyMaster = "front";
        }
      }


      // --------------------------------------
      // 公開MASTER URL
      // --------------------------------------
      const origin = url.origin;

      const faceUrl =
        `${origin}/master-public/face/${faceMaster}.png`;

      const bodyUrl =
        `${origin}/master-public/body/${bodyMaster}.png`;


      return json({
        ok: true,

        request: {
          angle,
          framing,
          expression,
          pose
        },

        selected: {
          face: {
            id: faceMaster,
            url: faceUrl
          },

          body: {
            id: bodyMaster,
            url: bodyUrl
          }
        },

        instructions: {
          face:
            "Use FACE MASTER only as Yuzuho identity, facial structure, facial proportions, eyes, nose, mouth, jawline and hairstyle reference.",

          body:
            "Use BODY MASTER only as Yuzuho body identity, proportions, silhouette and physique reference.",

          preserve:
            "Do not redesign Yuzuho's face, facial proportions, body proportions or hairstyle unless explicitly requested.",

          scene:
            "Do not copy clothing, background, lighting or scene from MASTER images unless explicitly requested."
        }
      });
    }


    // ========================================
    // 8. 従来の認証付きFACE MASTER
    // GET /master/face/{masterId}
    // ========================================
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/master/face/")
    ) {
      const masterId =
        url.pathname.split("/").pop();

      const allowed = [
        "front",
        "right45",
        "left45",
        "down_angle",
        "smile",
        "back"
      ];

      if (!allowed.includes(masterId)) {
        return json(
          {
            ok: false,
            error: "Unknown FACE MASTER"
          },
          404
        );
      }

      return getMasterAsset(
        request,
        env,
        "face",
        masterId
      );
    }


    // ========================================
    // 9. 従来の認証付きBODY MASTER
    // GET /master/body/{masterId}
    // ========================================
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/master/body/")
    ) {
      const masterId =
        url.pathname.split("/").pop();

      const allowed = [
        "front",
        "angle45",
        "side",
        "back",
        "back45",
        "relaxed"
      ];

      if (!allowed.includes(masterId)) {
        return json(
          {
            ok: false,
            error: "Unknown BODY MASTER"
          },
          404
        );
      }

      return getMasterAsset(
        request,
        env,
        "body",
        masterId
      );
    }


    // ========================================
    // 10. 存在しないURL
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
// MASTER asset取得
// ==========================================
async function getMasterAsset(
  request,
  env,
  type,
  masterId
) {
  if (!env.ASSETS) {
    return json(
      {
        ok: false,
        error:
          "ASSETS binding is not configured"
      },
      500
    );
  }

  const assetUrl = new URL(request.url);

  assetUrl.pathname =
    `/masters/${type}/${masterId}.png`;

  assetUrl.search = "";

  const assetRequest = new Request(
    assetUrl.toString(),
    {
      method: "GET",
      headers: request.headers
    }
  );

  const response =
    await env.ASSETS.fetch(assetRequest);

  if (!response.ok) {
    return json(
      {
        ok: false,
        error: "MASTER asset not found",
        type,
        masterId,
        status: response.status
      },
      404
    );
  }

  const headers =
    new Headers(response.headers);

  headers.set(
    "Content-Type",
    "image/png"
  );

  return new Response(
    response.body,
    {
      status: response.status,
      headers
    }
  );
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
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}


// ==========================================
// X APIレスポンスを返す
// ==========================================
async function proxyJson(response) {
  const text =
    await response.text();

  return new Response(
    text,
    {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get(
            "Content-Type"
          ) ||
          "application/json; charset=utf-8"
      }
    }
  );
}
