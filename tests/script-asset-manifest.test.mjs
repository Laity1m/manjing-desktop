import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadManifestModule() {
  const seriesSource = await readFile(new URL("../app/lib/series-project.ts", import.meta.url), "utf8");
  const seriesOutput = ts.transpileModule(seriesSource, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: "series-project.ts",
  }).outputText;
  const seriesUrl = `data:text/javascript;base64,${Buffer.from(seriesOutput).toString("base64")}`;
  const source = (await readFile(new URL("../app/lib/script-asset-manifest.ts", import.meta.url), "utf8"))
    .replace('from "./series-project"', `from "${seriesUrl}"`);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: "script-asset-manifest.ts",
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("builds local character and prop skeletons without image fields", async () => {
  const { fallbackScriptAssetManifest } = await loadManifestModule();
  const manifest = fallbackScriptAssetManifest(`Character: Mara Vale (32), forensic engineer.\nMARA\nOpen the case.\nProps: silver briefcase, broken wristwatch`);
  assert.equal(manifest.characters[0].name, "Mara Vale");
  assert.deepEqual(manifest.props.map((item) => item.name), ["silver briefcase", "broken wristwatch"]);
  assert.equal("imageUrl" in manifest.characters[0], false);
  assert.equal("imageUrl" in manifest.props[0], false);
});

test("treats the language-agent breakdown as authoritative and excludes narrator", async () => {
  const { parseScriptAssetManifest } = await loadManifestModule();
  const manifest = parseScriptAssetManifest(JSON.stringify({
    characters: [
      { name: "MARA", role: "Lead", appearance: "red coat", reason: "appears on screen" },
      { name: "NARRATOR", role: "voice", appearance: "none" },
    ],
    props: [{ name: "Keycard", description: "blue access card", importance: "hero", reason: "opens the lab" }],
  }), "MARA\nMove.\n[道具：损坏的相机]");
  assert.deepEqual(manifest.characters.map((item) => item.name), ["MARA"]);
  assert.equal(manifest.characters[0].role, "Lead");
  assert.deepEqual(manifest.props.map((item) => item.name), ["Keycard"]);
  assert.equal(manifest.props[0].importance, "hero");
});

test("does not classify project headings as characters and remembers synopsis/background", async () => {
  const { parseScriptAssetManifest } = await loadManifestModule();
  const manifest = parseScriptAssetManifest(JSON.stringify({
    synopsis: "林婉发现家族账本隐藏的秘密。",
    background: "故事发生在近未来海港城，林家控制着旧城区。",
    characters: [
      { name: "系列项目", role: "metadata", appearance: "none" },
      { name: "全剧背景故事", role: "metadata", appearance: "none" },
      { name: "林婉", role: "调查记者", appearance: "灰色风衣", needsVoice: true, firstDialogue: "账本不是假的。" },
    ],
    props: [{ name: "家族账本", description: "磨损的黑皮账本", importance: "recurring" }],
  }), "系列项目：测试\n剧本简介：林婉调查旧案\n全剧背景故事：海港城\n林婉：账本不是假的。");
  assert.deepEqual(manifest.characters.map((item) => item.name), ["林婉"]);
  assert.equal(manifest.characters[0].needsVoice, true);
  assert.equal(manifest.characters[0].firstDialogue, "账本不是假的。");
  assert.equal(manifest.synopsis, "林婉发现家族账本隐藏的秘密。");
  assert.match(manifest.background, /近未来海港城/);
});

test("rejects biography headings and VO or OS markers in both AI and local extraction", async () => {
  const { fallbackScriptAssetManifest, parseScriptAssetManifest } = await loadManifestModule();
  const script = "小传：野心勃勃的权势掌控者。\n-VO-：沉闷的皮靴踏地声。\nV.O.：风声渐近。\n苏梨（OS）：白天那个高高在上的贵子。\n苏梨：王爷来了！";
  const fromAgent = parseScriptAssetManifest(JSON.stringify({
    characters: [
      { name: "小传", role: "metadata", appearance: "人物介绍栏目" },
      { name: "-VO-", role: "audio cue", appearance: "none" },
      { name: "V.O.", role: "audio cue", appearance: "none" },
      { name: "OS", role: "audio cue", appearance: "none" },
      { name: "苏梨", role: "女主", appearance: "白衣", needsVoice: true, firstDialogue: "王爷来了！" },
    ],
  }), script);
  assert.deepEqual(fromAgent.characters.map((item) => item.name), ["苏梨"]);

  const local = fallbackScriptAssetManifest(script);
  assert.deepEqual(local.characters.map((item) => item.name), ["苏梨"]);
});

test("uses visual-identity evidence instead of accepting every script label as a person", async () => {
  const { fallbackScriptAssetManifest, parseScriptAssetManifest } = await loadManifestModule();
  const script = `片名：雨夜归人
单集时长：90秒
本集梗概：苏梨回府质问摄政王。
人物关系：苏梨与摄政王互相试探。
场次1：王府书房，夜，内
镜号：1-1
景别：中景
运镜：缓慢横移
SFX：皮靴踏地
群演甲：王爷来了！
路人A：快走！
苏梨（V.O.）：白天那个高高在上的贵子。
摄政王：你终于回来了。`;
  const fromAgent = parseScriptAssetManifest(JSON.stringify({
    characters: [
      { name: "项目信息", role: "metadata", appearance: "none", requiresVisualAsset: true },
      { name: "场次1", role: "heading", appearance: "none", requiresVisualAsset: true },
      { name: "SFX", role: "sound cue", appearance: "none", requiresVisualAsset: true },
      { name: "群演甲", role: "extra", appearance: "模糊背景人物", requiresVisualAsset: true },
      { name: "路人A", role: "extra", appearance: "一闪而过", requiresVisualAsset: true },
      { name: "苏梨（V.O.）", role: "女主", appearance: "白衣", requiresVisualAsset: true, visualEvidence: "随后进入王府书房", needsVoice: true, firstDialogue: "白天那个高高在上的贵子。" },
      { name: "摄政王", role: "男主，声音低沉", appearance: "玄衣，声音沙哑", requiresVisualAsset: true, visualEvidence: "书房内正面出镜", needsVoice: true, firstDialogue: "你终于回来了。" },
      { name: "神秘来电者", role: "仅声音", appearance: "从不出镜", requiresVisualAsset: true, voiceOnly: true },
    ],
  }), script);
  assert.deepEqual(fromAgent.characters.map((item) => item.name), ["苏梨", "摄政王"]);
  assert.match(fromAgent.characters[1].appearance, /声音沙哑/);

  const local = fallbackScriptAssetManifest(script);
  assert.deepEqual(local.characters.map((item) => item.name), ["苏梨", "摄政王"]);
  assert.equal(local.characters[0].firstDialogue, "白天那个高高在上的贵子。");
});

test("keeps one identity while splitting per-episode costume and state assets", async () => {
  const { parseScriptAssetManifest } = await loadManifestModule();
  const manifest = parseScriptAssetManifest(JSON.stringify({
    characters: [
      { name: "男主", identityName: "男主", lookName: "白衣版", episodeScope: "第1集", sceneHints: ["祭典", "1-1"], appearance: "白色长袍" },
      { name: "男主", identityName: "男主", lookName: "黑衣常服版", episodeScope: "第1集", sceneHints: ["回府", "1-5"], appearance: "黑色常服" },
    ],
  }), "第1集\n男主在祭典穿白衣，回府后换黑衣。\n男主：走吧。\n");
  assert.equal(manifest.characters.length, 2);
  assert.deepEqual(manifest.characters.map((item) => item.identityName), ["男主", "男主"]);
  assert.deepEqual(manifest.characters.map((item) => item.lookName), ["白衣版", "黑衣常服版"]);
  assert.deepEqual(manifest.characters[0].sceneHints, ["祭典", "1-1"]);
});

test("merges location and time aliases when the visible home costume did not change", async () => {
  const { parseScriptAssetManifest } = await loadManifestModule();
  const manifest = parseScriptAssetManifest(JSON.stringify({
    characters: [
      { name: "苏梨", identityName: "苏梨", lookName: "破院居家版", appearance: "淡棕粉色家常衫和深灰长裙", sceneHints: ["破院日间"] },
      { name: "苏梨", identityName: "苏梨", lookName: "夜间居家版", appearance: "同一套淡棕粉色家常衫和深灰长裙", sceneHints: ["破院夜间"] },
    ],
  }), "苏梨从白天忙到夜里，期间没有换衣。\n");
  assert.equal(manifest.characters.length, 1);
  assert.equal(manifest.characters[0].lookName, "居家版");
});

test("splits long scripts without dropping the final episode and merges chunk manifests", async () => {
  const { mergeScriptAssetManifests, parseScriptAssetManifest, splitScriptForAssetAnalysis } = await loadManifestModule();
  const script = `第一集\n${"苏梨在破院生活。\n".repeat(500)}\n第二集\n${"萧珏进入王府。\n".repeat(500)}\n第三集\n尾声唯一标记XYZ`;
  const chunks = splitScriptForAssetAnalysis(script, 4000);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.some((item) => item.includes("尾声唯一标记XYZ")));
  const merged = mergeScriptAssetManifests([
    parseScriptAssetManifest(JSON.stringify({ characters: [{ name: "苏梨", identityName: "苏梨", lookName: "破院居家版", appearance: "家常衫", sceneHints: ["第一集"] }] }), chunks[0]),
    parseScriptAssetManifest(JSON.stringify({ characters: [{ name: "苏梨", identityName: "苏梨", lookName: "夜间居家版", appearance: "同一套家常衫", sceneHints: ["第二集"] }], props: [{ name: "账本", description: "黑皮账本", importance: "recurring" }] }), chunks.at(-1)),
  ]);
  assert.equal(merged.characters.length, 1);
  assert.deepEqual(merged.characters[0].sceneHints, ["第一集", "第二集"]);
  assert.equal(merged.props[0].name, "账本");
});

test("extracts canonical scene skeletons separately from storyboard frames", async () => {
  const { parseScriptAssetManifest } = await loadManifestModule();
  const manifest = parseScriptAssetManifest(JSON.stringify({
    scenes: [{ name: "摄政王府书房", environmentKey: "王府书房-夜", description: "东墙长窗，西侧书案，烛光从右侧照入", timeWeather: "深夜小雨", episodeScope: "第1集", sceneHints: ["1-1", "洗官服"] }],
  }), "场景：摄政王府书房\n男主深夜洗官服。\n");
  assert.equal(manifest.scenes.length, 1);
  assert.equal(manifest.scenes[0].environmentKey, "王府书房-夜");
  assert.match(manifest.scenes[0].description, /东墙长窗/);
});

test("rejects shot functions and narrative beats as canonical scene assets", async () => {
  const { isReusableSceneAssetCandidate, parseScriptAssetManifest } = await loadManifestModule();
  const manifest = parseScriptAssetManifest(JSON.stringify({
    scenes: [
      { name: "户部公廨大厅", environmentKey: "户部公廨大厅", description: "官署大厅" },
      { name: "异样开场", environmentKey: "异样开场", description: "建立故事空间" },
      { name: "线索逼近", environmentKey: "线索逼近", description: "关键人物进入画面" },
      { name: "冲突反转", environmentKey: "冲突反转", description: "矛盾爆发" },
      { name: "悬念收束", environmentKey: "悬念收束", description: "下一集钩子" },
    ],
  }), "场景：户部公廨大厅\n苏梨进入大厅。\n");
  assert.deepEqual(manifest.scenes.map((item) => item.environmentKey), ["户部公廨大厅"]);
  assert.equal(isReusableSceneAssetCandidate("场景-5", "场景-5"), false);
  assert.equal(isReusableSceneAssetCandidate("摄政王府书房", "摄政王府书房"), true);
});

test("turns machine scene identifiers into Chinese display names without changing reuse keys", async () => {
  const { parseScriptAssetManifest } = await loadManifestModule();
  const firstKey = "EP01_ENV_SU_LI_DILAPIDATED_COURTYARD_NIGHT";
  const secondKey = "EP01_ENV_MINISTRY_REVENUE_OFFICE_HALL_DAY";
  const thirdKey = "EP02_ENV_SU_LI_DILAPIDATED_COURTYARD_NIGHT";
  const manifest = parseScriptAssetManifest(JSON.stringify({
    scenes: [
      { name: firstKey, environmentKey: firstKey, description: "大景朝晚春雨夜的破旧小型民居院落，地面湿润。", timeWeather: "雨夜" },
      { name: secondKey, environmentKey: secondKey, description: "大景朝晚春晴日上午的户部公廨大厅，官吏来往。", timeWeather: "晴日上午" },
      { name: thirdKey, environmentKey: thirdKey, description: "No localized description", timeWeather: "night" },
    ],
  }), "第一集，苏梨夜归院落，次日上午前往户部公廨。\n");
  assert.equal(manifest.scenes[0].name, "破旧小型民居院落");
  assert.equal(manifest.scenes[0].environmentKey, firstKey);
  assert.equal(manifest.scenes[1].name, "户部公廨大厅");
  assert.equal(manifest.scenes[1].environmentKey, secondKey);
  assert.equal(manifest.scenes[2].name, "苏梨破败庭院·夜");
});
