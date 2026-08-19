import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { enterpriseConfig, validateConfig } = require("../windows-app/enterprise-assets.js");

test("enterprise config derives a private TOS endpoint and never accepts basic plan", () => {
  const config = enterpriseConfig({
    companyName: "漫镜测试企业",
    plan: "basic",
    accessKeyId: "ak-test",
    secretKey: "sk-test",
    projectName: "default",
    callbackUrl: "https://example.com/ark/callback",
    tosBucket: "portrait-assets",
    tosRegion: "cn-shanghai",
  });
  assert.equal(config.plan, "advanced");
  assert.equal(config.tosEndpoint, "tos-cn-shanghai.volces.com");
  assert.equal(validateConfig(config, { requireTos: true }), config);
});

test("enterprise config rejects insecure callbacks and incomplete TOS automation", () => {
  const base = enterpriseConfig({ companyName: "企业", accessKeyId: "ak", secretKey: "sk", callbackUrl: "http://example.com" });
  assert.throws(() => validateConfig(base), /HTTPS/);
  assert.throws(() => validateConfig({ ...base, callbackUrl: "https://example.com" }, { requireTos: true }), /TOS Bucket/);
});

test("desktop enterprise bridge keeps actor tokens server-side and supports one-shot resume", async () => {
  const runtime = await readFile(new URL("../windows-app/desktop-runtime.js", import.meta.url), "utf8");
  const panel = await readFile(new URL("../app/assets/EnterpriseAssetPanel.tsx", import.meta.url), "utf8");
  const studio = await readFile(new URL("../app/studio-client.tsx", import.meta.url), "utf8");
  assert.match(runtime, /byt[e]?dToken/);
  assert.doesNotMatch(runtime.match(/function enterprisePublicState[\s\S]*?function trimEnterpriseSessions/)?.[0] || "", /byt[e]?dToken/);
  assert.match(panel, /manjing-studio-resume-video-after-portrait-v1/);
  assert.match(studio, /portraitResumeStartedRef/);
  assert.match(studio, /removeItem\("manjing-studio-resume-video-after-portrait-v1"\)/);
});
