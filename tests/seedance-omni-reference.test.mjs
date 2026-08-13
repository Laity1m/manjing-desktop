import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { invokeSeedance } = require("../windows-app/desktop-runtime.js");

test("desktop Seedance converts continuity frames to omni image references", async () => {
  let createBody = null;
  const result = await invokeSeedance({
    action: "create",
    requestId: "omni-frame-reference-test",
    apiKey: "test-seedance-key",
    model: "doubao-seedance-2-0-260128",
    prompt: "让人物从上一镜的结束位置自然继续动作",
    references: [
      { kind: "image", role: "first_frame", url: "https://media.volces.com/previous-tail.jpg", name: "上一镜尾帧" },
      { kind: "image", role: "last_frame", url: "https://media.volces.com/current-target.jpg", name: "本镜目标尾帧" },
      { kind: "image", role: "reference_image", url: "https://media.volces.com/character.jpg", name: "人物" },
      { kind: "audio", role: "reference_audio", url: "https://media.volces.com/voice.mp3", name: "音色" },
    ],
  }, async (_url, init) => {
    createBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "cgt-omnimedia1" }), { status: 200 });
  });

  assert.equal(result.id, "cgt-omnimedia1");
  const mediaRoles = createBody.content.filter((item) => item.type !== "text").map((item) => item.role);
  assert.deepEqual(mediaRoles, ["reference_image", "reference_image", "reference_image", "reference_audio"]);
  assert.equal(mediaRoles.includes("first_frame"), false);
  assert.equal(mediaRoles.includes("last_frame"), false);
});
