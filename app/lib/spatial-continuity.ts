export type SpatialDepth = "foreground" | "midground" | "background";

export type SpatialAnchor = {
  x: number;
  y: number;
  scale: number;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number; scaleMin: number; scaleMax: number };
  depth: SpatialDepth;
  facing: "left" | "right" | "camera";
  source: "script" | "inherited" | "deterministic";
};

export type SpatialScene = {
  characters?: string[];
  environmentKey?: string;
  environmentBible?: string;
  visual?: string;
  action?: string;
  startState?: string;
  endState?: string;
  videoRevisionRequest?: string;
  spatialLayout?: Record<string, SpatialAnchor>;
  consistencyReport?: { findings?: string[] };
};

function cleanName(value: string) {
  return String(value || "").trim();
}

function environmentIdentity(scene: SpatialScene) {
  return cleanName(scene.environmentKey || scene.environmentBible || scene.visual || "default-environment").toLocaleLowerCase();
}

function requestedAnchor(scene: SpatialScene, name: string): Partial<SpatialAnchor> {
  const text = [scene.visual, scene.action, scene.startState, scene.endState].filter(Boolean).join(" ");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nearby = text.match(new RegExp(`(?:${escaped}.{0,32}|.{0,32}${escaped})`, "i"))?.[0] || "";
  const x = /(?:画面|镜头|screen[- ]?)?(?:左侧|左边|左方|左位|左端|left)/i.test(nearby) ? 0.28
    : /(?:画面|镜头|screen[- ]?)?(?:右侧|右边|右方|右位|右端|right)/i.test(nearby) ? 0.72
      : /(?:画面|镜头)?(?:中央|中间|正中|中心)|\bcenter\b/i.test(nearby) ? 0.5 : undefined;
  const depth: SpatialDepth | undefined = /前景|foreground/i.test(nearby) ? "foreground"
    : /后景|远景|background/i.test(nearby) ? "background"
      : /中景|midground/i.test(nearby) ? "midground" : undefined;
  const facing = /(?:面向|朝向|看向).{0,6}(?:左|left)/i.test(nearby) ? "left"
    : /(?:面向|朝向|看向).{0,6}(?:右|right)/i.test(nearby) ? "right"
      : /(?:正面|面向镜头|看向镜头|camera)/i.test(nearby) ? "camera" : undefined;
  return { ...(typeof x === "number" ? { x } : {}), ...(depth ? { depth } : {}), ...(facing ? { facing } : {}) };
}

function nearestFreeSlot(occupied: number[], preferred: number) {
  const candidates = [preferred, 0.28, 0.72, 0.5, 0.16, 0.84, 0.4, 0.6];
  return candidates.find((candidate) => occupied.every((value) => Math.abs(value - candidate) >= 0.12)) ?? preferred;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function completeAnchor(input: Partial<SpatialAnchor> & Pick<SpatialAnchor, "x" | "depth" | "facing" | "source">): SpatialAnchor {
  const y = Number(input.y ?? (input.depth === "foreground" ? 0.57 : input.depth === "background" ? 0.48 : 0.52));
  const scale = Number(input.scale ?? (input.depth === "foreground" ? 1.15 : input.depth === "background" ? 0.78 : 1));
  return {
    ...input,
    y,
    scale,
    bounds: input.bounds || {
      xMin: clamp(input.x - 0.06, 0, 1), xMax: clamp(input.x + 0.06, 0, 1),
      yMin: clamp(y - 0.07, 0, 1), yMax: clamp(y + 0.07, 0, 1),
      scaleMin: Math.max(0.1, scale - 0.08), scaleMax: scale + 0.08,
    },
  };
}

export function assignSpatialLayouts<T extends SpatialScene>(scenes: T[]): T[] {
  const environmentAnchors = new Map<string, Map<string, SpatialAnchor>>();
  return scenes.map((scene) => {
    const environment = environmentIdentity(scene);
    const registry = environmentAnchors.get(environment) || new Map<string, SpatialAnchor>();
    environmentAnchors.set(environment, registry);
    const names = [...new Set((scene.characters || []).map(cleanName).filter(Boolean))];
    const current: Record<string, SpatialAnchor> = {};
    const occupied: number[] = [];

    for (const name of names) {
      const scripted = requestedAnchor(scene, name);
      const stored = scene.spatialLayout?.[name] || registry.get(name);
      if (!stored && typeof scripted.x !== "number") continue;
      const anchor = completeAnchor({
        x: typeof scripted.x === "number" ? scripted.x : Number(stored?.x ?? 0.5),
        y: stored?.y,
        scale: stored?.scale,
        bounds: stored?.bounds,
        depth: scripted.depth || stored?.depth || "midground",
        facing: scripted.facing || stored?.facing || "camera",
        source: typeof scripted.x === "number" || scripted.depth || scripted.facing ? "script" : "inherited",
      });
      current[name] = anchor;
      occupied.push(anchor.x);
      registry.set(name, anchor);
    }

    const defaults = names.length <= 1 ? [0.5] : names.length === 2 ? [0.32, 0.68] : names.map((_, index) => 0.18 + (index * 0.64) / Math.max(1, names.length - 1));
    names.forEach((name, index) => {
      if (current[name]) return;
      const scripted = requestedAnchor(scene, name);
      const x = nearestFreeSlot(occupied, typeof scripted.x === "number" ? scripted.x : defaults[index]);
      const anchor = completeAnchor({ x, depth: scripted.depth || "midground", facing: scripted.facing || "camera", source: Object.keys(scripted).length ? "script" : "deterministic" });
      current[name] = anchor;
      occupied.push(x);
      registry.set(name, anchor);
    });
    return { ...scene, spatialLayout: current };
  });
}

export function positionLockRequested(scene: SpatialScene) {
  const text = [scene.videoRevisionRequest, ...(scene.consistencyReport?.findings || [])].filter(Boolean).join(" ");
  return /(?:位置|站位|构图|左右关系|前后景|screen position).{0,24}(?:锁定|固定|不变|不要变|保持|按照|依照|一致|变动|变化|漂移)|(?:锁定|固定|保持|按照|依照).{0,24}(?:位置|站位|构图|左右关系|前后景)/i.test(text);
}

export function spatialLayoutSummary(scene: SpatialScene) {
  return Object.entries(scene.spatialLayout || {}).map(([name, anchor]) => `${name}: normalized center (x=${anchor.x.toFixed(2)}, y=${anchor.y.toFixed(2)}), scale=${anchor.scale.toFixed(2)}, allowed x=[${anchor.bounds.xMin.toFixed(2)},${anchor.bounds.xMax.toFixed(2)}], y=[${anchor.bounds.yMin.toFixed(2)},${anchor.bounds.yMax.toFixed(2)}], scale=[${anchor.bounds.scaleMin.toFixed(2)},${anchor.bounds.scaleMax.toFixed(2)}], ${anchor.depth}, facing ${anchor.facing}`).join(" | ");
}
