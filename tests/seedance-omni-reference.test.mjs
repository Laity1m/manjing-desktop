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

test("endpoint IDs stay in explicit omni mode and never become first-frame video", async () => {
  let createBody = null;
  const result = await invokeSeedance({
    action: "create",
    requestId: "endpoint-omni-reference-test",
    apiKey: "test-seedance-key",
    model: "ep-20260817000000-abcde",
    referenceMode: "omni",
    imageUrl: "https://media.volces.com/forbidden-first-frame.jpg",
    prompt: "直接根据人物场景和道具资产生成连续动态镜头",
    references: [
      { kind: "image", role: "first_frame", url: "https://media.volces.com/character.jpg", name: "人物资产" },
      { kind: "image", role: "reference_image", url: "https://media.volces.com/environment.jpg", name: "场景资产" },
    ],
  }, async (_url, init) => {
    createBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "cgt-endpointomni1" }), { status: 200 });
  });

  assert.equal(result.id, "cgt-endpointomni1");
  const media = createBody.content.filter((item) => item.type !== "text");
  assert.deepEqual(media.map((item) => item.role), ["reference_image", "reference_image"]);
  assert.equal(media.some((item) => item.image_url?.url.includes("forbidden-first-frame")), false);
  assert.match(createBody.content[0].text, /绝不作为首帧控制/);
});

test("legacy model requests never silently promote an image to first frame", async () => {
  let createBody = null;
  const result = await invokeSeedance({
    action: "create",
    requestId: "legacy-no-first-frame-test",
    apiKey: "test-seedance-key",
    model: "doubao-seedance-1-5-pro-251215",
    imageUrl: "https://media.volces.com/forbidden-first-frame.jpg",
    prompt: "只根据文字直接生成视频，不使用首帧控制",
    references: [{ kind: "image", url: "https://media.volces.com/also-not-first-frame.jpg", name: "普通参考" }],
  }, async (_url, init) => {
    createBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "cgt-legacytextonly1" }), { status: 200 });
  });

  assert.equal(result.id, "cgt-legacytextonly1");
  assert.deepEqual(createBody.content.map((item) => item.type), ["text"]);
  assert.equal(result.acceptedReferences.length, 0);
  assert.equal(result.ignoredReferences, 1);
});

test("Seedance drops local video/audio references that Ark cannot fetch as web URLs", async () => {
  let createBody = null;
  const result = await invokeSeedance({
    action: "create",
    requestId: "omni-public-media-url-test",
    apiKey: "test-seedance-key",
    model: "doubao-seedance-2-0-260128",
    prompt: "继续上一镜动作，但本机视频不可提交时仍然生成当前镜头",
    references: [
      { kind: "video", role: "reference_video", url: "data:video/mp4;base64,AAAA", name: "本机上一镜" },
      { kind: "audio", role: "reference_audio", url: "data:audio/wav;base64,AAAA", name: "本机音色" },
      { kind: "video", role: "reference_video", url: "https://media.volces.com/approved-previous.mp4", name: "公网上一镜" },
      { kind: "image", role: "reference_image", url: "https://media.volces.com/character.jpg", name: "人物" },
    ],
  }, async (_url, init) => {
    createBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "cgt-publicmedia1" }), { status: 200 });
  });

  assert.equal(result.id, "cgt-publicmedia1");
  const media = createBody.content.filter((item) => item.type !== "text");
  assert.deepEqual(media.map((item) => item.role), ["reference_video", "reference_image"]);
  assert.equal(media.some((item) => String(item.video_url?.url || "").startsWith("data:")), false);
  assert.equal(result.ignoredReferences, 2);
});
