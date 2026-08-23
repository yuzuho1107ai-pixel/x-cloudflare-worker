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
          publicMasterAssets: true,
          openAIImageGeneration: true
        }
      });
    }


    // ========================================
    // 2. PUBLIC MASTER
    // 認証なしで画像生成APIから参照可能にする
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

      const assetUrl = new URL(request.url);
      assetUrl.pathname = `/masters/${type}/${masterId}.png`;
      assetUrl.search = "";

      const response = await env.ASSETS.fetch(
        new Request(assetUrl.toString(), {
          method: "GET"
        })
      );

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
            "Use FACE MASTER as Yuzuho identity reference.",
          body:
            "Use BODY MASTER as Yuzuho body identity reference.",
          preserve:
            "Preserve facial identity, hair length, hair texture, hairstyle and body proportions.",
          scene:
            "Do not copy clothing, background, lighting or scene from MASTER images unless explicitly requested."
        }
      });
    }


    // ========================================
    // 8. YUZUHO画像生成
    //
    // POST /image/generate
    //
    // MASTER選択までWorker側で自動実行し、
    // FACE/BODY MASTERをOpenAIへ実画像入力する
    // ========================================
    if (
      url.pathname === "/image/generate" &&
      request.method === "POST"
    ) {
      if (!env.OPENAI_API_KEY) {
        return json(
          {
            ok: false,
            error: "OPENAI_API_KEY is not configured"
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


      const prompt =
        typeof body.prompt === "string"
          ? body.prompt.trim()
          : "";

      if (!prompt) {
        return json(
          {
            ok: false,
            error: "prompt is required"
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


      const origin = url.origin;

      const faceMasterUrl =
        `${origin}/master-public/face/${faceMaster}.png`;

      const bodyMasterUrl =
        `${origin}/master-public/body/${bodyMaster}.png`;


      const imagePrompt = `
Create a new social-media-style photograph of Yuzuho.

The two supplied images are identity references for the SAME adult fictional character.

FACE MASTER:
Preserve Yuzuho's recognizable facial identity, facial proportions, facial structure, eyes, nose, lips, jawline, ears, forehead, head shape, bangs, hairstyle, hair texture, hair density and especially the existing hair length.

BODY MASTER:
Preserve Yuzuho's established physique, shoulder width, torso proportions, waist, hips, arm proportions, leg proportions and overall silhouette.

IMPORTANT:
- Do not redesign her face.
- Do not make her hair longer or shorter.
- Do not change her hair texture.
- Do not alter her body type.
- Do not copy the MASTER clothing or background unless requested.
- The MASTER images define identity, not the new scene.
- Keep the result photorealistic and like a natural smartphone SNS photo.
- Avoid an overly polished AI portrait look.
- Avoid excessive beauty retouching.
- Keep the person naturally integrated into the environment.

Requested scene:
${prompt}
      `.trim();


      // --------------------------------------
      // OpenAI Responses API
      // FACE/BODY MASTERをinput_imageとして実際に渡す
      // --------------------------------------
      const openaiResponse = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            model: "gpt-5",

            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: imagePrompt
                  },
                  {
                    type: "input_image",
                    image_url: faceMasterUrl,
                    detail: "high"
                  },
                  {
                    type: "input_image",
                    image_url: bodyMasterUrl,
                    detail: "high"
                  }
                ]
              }
            ],

            tools: [
              {
                type: "image_generation",
                model: "gpt-image-1.5",
                input_fidelity: "high",
                quality: "high",
                size: "1024x1536",
                output_format: "png"
              }
            ],

            tool_choice: {
              type: "image_generation"
            }
          })
        }
      );


      let result;

      try {
        result =
          await openaiResponse.json();
      } catch {
        return json(
          {
            ok: false,
            error:
              "OpenAI returned a non-JSON response",
            status: openaiResponse.status
          },
          502
        );
      }


      if (!openaiResponse.ok) {
        return json(
          {
            ok: false,
            error:
              "OpenAI image generation failed",
            status: openaiResponse.status,
            details: result
          },
          openaiResponse.status
        );
      }


      // --------------------------------------
      // image_generation_callを探す
      // --------------------------------------
      const imageCall =
        Array.isArray(result.output)
          ? result.output.find(
              item =>
                item.type ===
                "image_generation_call"
            )
          : null;


      if (
        !imageCall ||
        !imageCall.result
      ) {
        return json(
          {
            ok: false,
            error:
              "No generated image was returned",
            responseId:
              result.id || null
          },
          500
        );
      }


      return json({
        ok: true,

        masters: {
          face: {
            id: faceMaster,
            url: faceMasterUrl
          },
          body: {
            id: bodyMaster,
            url: bodyMasterUrl
          }
        },

        generation: {
          visualReferenceUsed: true,
          inputFidelity: "high",
          format: "png",
          imageBase64: imageCall.result
        }
      });
    }


    // ========================================
    // 9. 認証付きFACE MASTER
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
    // 10. 認証付きBODY MASTER
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
    // 11. 存在しないURL
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

  const assetUrl =
    new URL(request.url);

  assetUrl.pathname =
    `/masters/${type}/${masterId}.png`;

  assetUrl.search = "";

  const response =
    await env.ASSETS.fetch(
      new Request(
        assetUrl.toString(),
        {
          method: "GET"
        }
      )
    );

  if (!response.ok) {
    return json(
      {
        ok: false,
        error:
          "MASTER asset not found",
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
// X APIレスポンス
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
