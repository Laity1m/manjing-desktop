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

test("extracts canonical scene skeletons separately from storyboard frames", async () => {
  const { parseScriptAssetManifest } = await loadManifestModule();
  const manifest = parseScriptAssetManifest(JSON.stringify({
    scenes: [{ name: "摄政王府书房", environmentKey: "王府书房-夜", description: "东墙长窗，西侧书案，烛光从右侧照入", timeWeather: "深夜小雨", episodeScope: "第1集", sceneHints: ["1-1", "洗官服"] }],
  }), "场景：摄政王府书房\n男主深夜洗官服。\n");
  assert.equal(manifest.scenes.length, 1);
  assert.equal(manifest.scenes[0].environmentKey, "王府书房-夜");
  assert.match(manifest.scenes[0].description, /东墙长窗/);
});
