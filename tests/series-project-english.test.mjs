import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadSeriesProjectModule() {
  const source = await readFile(new URL("../app/lib/series-project.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: "series-project.ts",
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("splits English screenplay episode headings and preserves titles", async () => {
  const { splitEpisodes } = await loadSeriesProjectModule();
  const episodes = splitEpisodes(`SERIES BIBLE\n\nEPISODE 1 - The Arrival\nINT. TRAIN STATION - NIGHT\nMARA\nWe are too late.\n\nEP. 2: False Signal\nEXT. ROOFTOP - DAWN\nELIAS: Then we make our own signal.`);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].number, 1);
  assert.equal(episodes[0].title, "The Arrival");
  assert.match(episodes[0].content, /INT\. TRAIN STATION/);
  assert.equal(episodes[1].number, 2);
  assert.equal(episodes[1].title, "False Signal");
});

test("extracts English screenplay character cues without treating scene headings as cast", async () => {
  const { extractCharacters } = await loadSeriesProjectModule();
  const characters = extractCharacters(`FADE IN:\nINT. DINER - NIGHT\nMARA\nI know what you did.\nELIAS (V.O.)\nThat was never the plan.\nNARRATOR: The city keeps its secrets.\nCUT TO:\nEXT. STREET - NIGHT`);
  assert.deepEqual(characters.map((item) => item.name), ["MARA", "ELIAS"]);
});

test("supports English profile and colon-dialogue formats", async () => {
  const { extractCharacters } = await loadSeriesProjectModule();
  const characters = extractCharacters(`Character: Mara Vale (32), a guarded forensic engineer with a mechanical left hand.\nMara Vale: Keep the door closed.\nJon O'Neil: I wasn't planning to open it.`);
  assert.deepEqual(characters.map((item) => item.name), ["Mara Vale", "Jon O'Neil"]);
  assert.match(characters[0].description, /forensic engineer/i);
});

test("rejects screenplay structure, production metadata, sound cues and generic extras", async () => {
  const { extractCharacters, isGenericNonAssetCharacter, isNonCharacterLabel, normalizeScriptCharacterName } = await loadSeriesProjectModule();
  const characters = extractCharacters(`PROJECT TITLE: False Signal
LOGLINE: A detective follows a missing transmission.
CHARACTER BREAKDOWN:
MONTAGE
The city wakes beneath the rain.
BLACK SCREEN
A distant siren rises.
SFX: METAL DOOR SLAMS
BOOM
The windows tremble.
CROWD: Run!
MAN #1: Look out!
MARA (V.O.)
I remember the signal.
ELIAS (O.S.)
Then stop listening.`);
  assert.deepEqual(characters.map((item) => item.name), ["MARA", "ELIAS"]);
  for (const label of ["PROJECT TITLE", "CHARACTER BREAKDOWN", "MONTAGE", "BLACK SCREEN", "SFX", "SMASH CUT", "TITLE CARD", "CONTINUOUS", "THE END"]) {
    assert.equal(isNonCharacterLabel(label), true, label);
  }
  for (const label of ["CROWD", "MAN #1", "VOICE 2", "EXTRA A"]) assert.equal(isGenericNonAssetCharacter(label), true, label);
  assert.equal(normalizeScriptCharacterName("MARA (V.O.)"), "MARA");
  assert.equal(normalizeScriptCharacterName("ELIAS（O.S.）"), "ELIAS");
  assert.equal(normalizeScriptCharacterName("苏梨-VO-"), "苏梨");
  assert.equal(isNonCharacterLabel(normalizeScriptCharacterName("-VO-")), true);
});

test("supports Fountain forced and dual-dialogue character cues without importing outline syntax", async () => {
  const { extractCharacters } = await loadSeriesProjectModule();
  const characters = extractCharacters(`# ACT I
= The investigation begins.
.SNIPER SCOPE POV
!SCANNING THE AISLES
>SMASH CUT TO:
@McCLANE
Stay behind me.
STEEL ^
I can cover the door.`);
  assert.deepEqual(characters.map((item) => item.name), ["McCLANE", "STEEL"]);
});
