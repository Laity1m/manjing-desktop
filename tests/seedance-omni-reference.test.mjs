import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { invokeSeedance } = require("../windows-app/desktop-runtime.js");

test("desktop Seedance rejects first/last-frame inputs and keeps only omni references", async () => {
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
  assert.deepEqual(mediaRoles, ["reference_image", "reference_audio"]);
  assert.equal(mediaRoles.includes("first_frame"), false);
  assert.equal(mediaRoles.includes("last_frame"), false);
});

test("trusted Ark audio assets can be submitted as @Audio without a public URL", async () => {
  let createBody = null;
  const result = await invokeSeedance({
    action: "create",
    requestId: "omni-trusted-audio-asset",
    apiKey: "test-seedance-key",
    model: "doubao-seedance-2-0-260128",
    prompt: "保持角色音色并生成下一镜自然对白",
    references: [{ kind: "audio", role: "reference_audio", url: "asset://voice-canonical-001", name: "苏梨标准音色" }],
  }, async (_url, init) => {
    createBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "cgt-trustedaudio1" }), { status: 200 });
  });
  assert.equal(result.id, "cgt-trustedaudio1");
  assert.equal(createBody.content[1].role, "reference_audio");
  assert.equal(createBody.content[1].audio_url.url, "asset://voice-canonical-001");
});

test("real-person safety errors map content indexes back to exact character assets and cannot be blindly retried", async () => {
  await assert.rejects(() => invokeSeedance({
    action: "create",
    requestId: "portrait-content-index-map",
    apiKey: "test-seedance-key",
    model: "doubao-seedance-2-0-260128",
    prompt: "使用两个人物资产生成连续对白镜头",
    references: [
      { kind: "image", role: "reference_image", url: "https://media.volces.com/suli.jpg", name: "当前任务 Canonical 人物四区角色卡：苏梨-基础版", libraryAssetId: "asset-local-suli", identityKey: "苏梨", lookName: "基础版" },
      { kind: "image", role: "reference_image", url: "https://media.volces.com/linwan.jpg", name: "当前任务 Canonical 人物四区角色卡：林婉-白衣版", libraryAssetId: "asset-local-linwan", identityKey: "林婉", lookName: "白衣版" },
    ],
  }, async () => new Response(JSON.stringify({ error: { message: "The request failed because the input image 'content[1]' 'content[2]' may contain real person." } }), { status: 400 })), (error) => {
    assert.equal(error.failureKind, "portrait_authorization");
    assert.equal(error.retryable, false);
    assert.equal(error.requestId, "portrait-content-index-map");
    assert.deepEqual(error.blockedReferences.map((item) => ({ contentIndex: item.contentIndex, libraryAssetId: item.libraryAssetId, identityKey: item.identityKey, lookName: item.lookName })), [
      { contentIndex: 1, libraryAssetId: "asset-local-suli", identityKey: "苏梨", lookName: "基础版" },
      { contentIndex: 2, libraryAssetId: "asset-local-linwan", identityKey: "林婉", lookName: "白衣版" },
    ]);
    assert.match(error.message, /可信人像/);
    return true;
  });
});

test("authorized character Asset IDs are sent as trusted asset references", async () => {
  let createBody = null;
  const result = await invokeSeedance({
    action: "create",
    requestId: "trusted-character-asset-reference",
    apiKey: "test-seedance-key",
    model: "doubao-seedance-2-0-260128",
    prompt: "锁定已授权人物身份生成视频",
    references: [{ kind: "image", role: "reference_image", url: "asset://portrait-suli-authorized", name: "苏梨-基础版", libraryAssetId: "asset-local-suli", identityKey: "苏梨", lookName: "基础版" }],
  }, async (_url, init) => {
    createBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "cgt-trustedportrait1" }), { status: 200 });
  });
  assert.equal(result.id, "cgt-trustedportrait1");
  assert.equal(createBody.content[1].image_url.url, "asset://portrait-suli-authorized");
  assert.equal(result.acceptedReferences[0].libraryAssetId, "asset-local-suli");
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
  assert.deepEqual(media.map((item) => item.role), ["reference_image"]);
  assert.equal(media.some((item) => item.image_url?.url.includes("forbidden-first-frame")), false);
  assert.match(createBody.content[0].text, /绝不作为 first_frame\/last_frame 控制/);
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

test("Seedance retries one rejected web reference as canonical-image-only without duplicating a paid task", async () => {
  const bodies = [];
  let calls = 0;
  const result = await invokeSeedance({
    action: "create",
    requestId: "expired-reference-fallback-test",
    apiKey: "test-seedance-key",
    model: "doubao-seedance-2-0-260128",
    prompt: "上一镜公网地址失效时仍按人物和场景资产生成下一镜",
    references: [
      { kind: "video", role: "reference_video", url: "https://media.volces.com/expired.mp4", name: "上一镜" },
      { kind: "audio", role: "reference_audio", url: "https://media.volces.com/expired.wav", name: "音色" },
      { kind: "image", role: "reference_image", url: "https://media.volces.com/character.jpg", name: "Canonical人物" },
    ],
  }, async (_url, init) => {
    calls += 1;
    bodies.push(JSON.parse(String(init.body)));
    if (calls === 1) return new Response(JSON.stringify({ error: { message: "reference_video must be provided as a web url" } }), { status: 400 });
    return new Response(JSON.stringify({ id: "cgt-referencefallback1" }), { status: 200 });
  });

  assert.equal(calls, 2);
  assert.equal(result.id, "cgt-referencefallback1");
  assert.equal(result.referenceFallback, true);
  assert.deepEqual(bodies[0].content.filter((item) => item.type !== "text").map((item) => item.role), ["reference_video", "reference_audio", "reference_image"]);
  assert.deepEqual(bodies[1].content.filter((item) => item.type !== "text").map((item) => item.role), ["reference_image"]);
  assert.deepEqual(result.acceptedReferences.map((item) => item.role), ["reference_image"]);
});
