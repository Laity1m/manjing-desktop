export type SpatialDepth = "foreground" | "midground" | "background";

export type SpatialAnchor = {
  x: number;
  y: number;
  scale: number;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number; scaleMin: number; scaleMax: number };
  depth: SpatialDepth;
  facing: "left" | "right" | "camera";
  source: "script" | "inherited" | "deterministic" | "stage";
};

export type StageActor = {
  x: number;
  y: number;
  facing: number;
};

export type StageObject = {
  x: number;
  y: number;
  facing: number;
  size: number;
};

export type StageCamera = {
  x: number;
  y: number;
  angle: number;
  fieldOfView: number;
  elevation: number;
};

export type StageLayout = {
  version?: 2;
  enabled: boolean;
  /** True only after the user explicitly accepts the map. Inferred/default coordinates are drafts. */
  confirmed?: boolean;
  frozen: boolean;
  actors: Record<string, StageActor>;
  objects: Record<string, StageObject>;
  camera: StageCamera;
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
  objectSpatialLayout?: Record<string, SpatialAnchor>;
  stageLayout?: StageLayout;
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

function scriptedObjectNames(scene: SpatialScene) {
  const text = [scene.visual, scene.action, scene.startState, scene.endState].filter(Boolean).join(" ");
  const values: string[] = [];
  // Only immovable environment fixtures belong on the stage map. A normal prop,
  // costume or handheld item is referenced by the video model but has no fixed world coordinate.
  for (const match of text.matchAll(/\[(?:固定物体|场景锚点|固定陈设|fixture)[：:]([^\]]+)\]/gi)) values.push(...String(match[1] || "").split(/[，,、]/));
  return [...new Set(values.map(cleanName).filter(Boolean))].slice(0, 12);
}

export function defaultStageLayout(characters: string[] = [], objects: string[] = []): StageLayout {
  const names = [...new Set(characters.map(cleanName).filter(Boolean))];
  const objectNames = [...new Set(objects.map(cleanName).filter(Boolean))];
  const actors = Object.fromEntries(names.map((name, index) => [name, {
    x: names.length <= 1 ? 0.5 : 0.36 + (index * 0.28) / Math.max(1, names.length - 1),
    y: 0.48,
    facing: 180,
  }]));
  const stageObjects = Object.fromEntries(objectNames.map((name, index) => [name, {
    x: objectNames.length <= 1 ? 0.5 : 0.22 + (index * 0.56) / Math.max(1, objectNames.length - 1),
    y: 0.3,
    facing: 180,
    size: 1,
  }]));
  return { version: 2, enabled: false, confirmed: false, frozen: true, actors, objects: stageObjects, camera: { x: 0.5, y: 0.92, angle: -90, fieldOfView: 58, elevation: 0.18 } };
}

/** Converts a director's top-down stage map into normalized screen coordinates. */
export function projectStageLayout(layout: StageLayout): Record<string, SpatialAnchor> {
  const angle = layout.camera.angle * Math.PI / 180;
  const forwardX = Math.cos(angle);
  const forwardY = Math.sin(angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  const halfFov = Math.tan(clamp(layout.camera.fieldOfView, 25, 110) * Math.PI / 360);
  const projected: Record<string, SpatialAnchor> = {};
  for (const [name, actor] of Object.entries(layout.actors)) {
    const dx = actor.x - layout.camera.x;
    const dy = actor.y - layout.camera.y;
    const forward = Math.max(0.12, dx * forwardX + dy * forwardY);
    const lateral = dx * rightX + dy * rightY;
    const x = Number(clamp(0.5 + lateral / (2 * forward * halfFov), 0.06, 0.94).toFixed(4));
    const scale = Number(clamp(0.72 / forward, 0.58, 1.45).toFixed(4));
    const y = Number(clamp(0.58 - layout.camera.elevation * 0.34 + (forward - 0.5) * 0.08, 0.28, 0.74).toFixed(4));
    const relativeFacing = ((actor.facing - layout.camera.angle + 540) % 360) - 180;
    const facing: SpatialAnchor["facing"] = relativeFacing > 25 ? "right" : relativeFacing < -25 ? "left" : "camera";
    projected[name] = completeAnchor({ x, y, scale, depth: scale > 1.08 ? "foreground" : scale < 0.84 ? "background" : "midground", facing, source: "stage" });
  }
  return projected;
}

/** Projects fixed scene objects separately so they cannot be mistaken for cast. */
export function projectStageObjects(layout: StageLayout): Record<string, SpatialAnchor> {
  const actorProjection = projectStageLayout({ ...layout, actors: Object.fromEntries(Object.entries(layout.objects || {}).map(([name, object]) => [name, { x: object.x, y: object.y, facing: object.facing }])) });
  return Object.fromEntries(Object.entries(actorProjection).map(([name, anchor]) => {
    const size = clamp(layout.objects?.[name]?.size ?? 1, 0.3, 3);
    const scale = Number(clamp(anchor.scale * size, 0.2, 3).toFixed(4));
    return [name, { ...anchor, scale, bounds: { ...anchor.bounds, scaleMin: Math.max(0.1, scale - 0.1), scaleMax: scale + 0.1 } }];
  }));
}

function stageLayoutFromSpatial(anchors: Record<string, SpatialAnchor>): StageLayout {
  const layout = defaultStageLayout(Object.keys(anchors));
  const angle = layout.camera.angle * Math.PI / 180;
  const forwardDistance = 0.44;
  const halfFov = Math.tan(layout.camera.fieldOfView * Math.PI / 360);
  for (const [name, anchor] of Object.entries(anchors)) {
    const lateral = (anchor.x - 0.5) * 2 * forwardDistance * halfFov;
    layout.actors[name] = {
      x: clamp(layout.camera.x + lateral * -Math.sin(angle) + forwardDistance * Math.cos(angle), 0.04, 0.96),
      y: clamp(layout.camera.y + lateral * Math.cos(angle) + forwardDistance * Math.sin(angle), 0.04, 0.96),
      facing: anchor.facing === "left" ? layout.camera.angle - 90 : anchor.facing === "right" ? layout.camera.angle + 90 : layout.camera.angle,
    };
  }
  return layout;
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
  const environmentStages = new Map<string, StageLayout>();
  return scenes.map((scene) => {
    const environment = environmentIdentity(scene);
    const inheritedStage = scene.stageLayout || environmentStages.get(environment);
    const workingStage = inheritedStage ? {
      ...inheritedStage,
      version: 2 as const,
      actors: { ...inheritedStage.actors },
      // v1 created arbitrary prop coordinates automatically. Discard those
      // legacy objects unless the whole map had been explicitly confirmed.
      objects: inheritedStage.version === 2 || inheritedStage.confirmed === true ? { ...(inheritedStage.objects || {}) } : {},
      camera: { ...inheritedStage.camera },
    } : undefined;
    if (workingStage?.enabled && workingStage.confirmed === true) {
      const missing = (scene.characters || []).map(cleanName).filter(Boolean).filter((name) => !workingStage.actors[name]);
      const occupied = Object.values(workingStage.actors).map((actor) => actor.x);
      const slots = [0.5, 0.36, 0.64, 0.22, 0.78, 0.43, 0.57];
      missing.forEach((name, index) => {
        const x = slots.find((slot) => occupied.every((value) => Math.abs(value - slot) >= 0.1)) ?? clamp(0.18 + index * 0.13, 0.08, 0.92);
        workingStage.actors[name] = { x, y: 0.48, facing: 180 };
        occupied.push(x);
      });
      const missingObjects = scriptedObjectNames(scene).filter((name) => !workingStage.objects[name]);
      const occupiedObjects = Object.values(workingStage.objects).map((object) => object.x);
      missingObjects.forEach((name, index) => {
        const x = nearestFreeSlot(occupiedObjects, clamp(0.2 + index * 0.16, 0.08, 0.92));
        workingStage.objects[name] = { x, y: 0.3, facing: 180, size: 1 };
        occupiedObjects.push(x);
      });
      environmentStages.set(environment, workingStage);
      const projected = projectStageLayout(workingStage);
      const projectedObjects = projectStageObjects(workingStage);
      if (!scene.stageLayout) for (const anchor of Object.values(projected)) anchor.source = "inherited";
      if (!scene.stageLayout) for (const anchor of Object.values(projectedObjects)) anchor.source = "inherited";
      return { ...scene, stageLayout: workingStage, spatialLayout: projected, objectSpatialLayout: projectedObjects };
    }
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
    // Keep an unconfirmed per-shot draft if one exists, but never promote or
    // inherit it as the environment truth. Only a user-confirmed layout enters
    // environmentStages (handled by the active branch above).
    const stageLayout = workingStage ? {
      ...workingStage,
      actors: {
        ...Object.fromEntries(Object.entries(stageLayoutFromSpatial(current).actors)),
        ...workingStage.actors,
      },
      objects: { ...(workingStage.objects || {}) },
      camera: { ...workingStage.camera },
    } : stageLayoutFromSpatial(current);
    // Keep the textual/inherited anchor provenance while the stage is only a
    // visual draft. Projection becomes authoritative only after confirmation.
    return { ...scene, stageLayout, spatialLayout: current, objectSpatialLayout: {} };
  });
}

export function positionLockRequested(scene: SpatialScene) {
  if (scene.stageLayout?.enabled && scene.stageLayout.confirmed === true && scene.stageLayout.frozen) return true;
  const text = [scene.videoRevisionRequest, ...(scene.consistencyReport?.findings || [])].filter(Boolean).join(" ");
  return /(?:位置|站位|构图|左右关系|前后景|screen position).{0,24}(?:锁定|固定|不变|不要变|保持|按照|依照|一致|变动|变化|漂移)|(?:锁定|固定|保持|按照|依照).{0,24}(?:位置|站位|构图|左右关系|前后景)/i.test(text);
}

export function spatialLayoutSummary(scene: SpatialScene) {
  if (!scene.stageLayout?.enabled || scene.stageLayout.confirmed !== true) return "";
  const prefix = `USER-CONFIRMED 2.5D TOP-DOWN STAGE PROJECTION; camera=(x=${scene.stageLayout.camera.x.toFixed(2)}, y=${scene.stageLayout.camera.y.toFixed(2)}, angle=${scene.stageLayout.camera.angle.toFixed(0)}deg, FOV=${scene.stageLayout.camera.fieldOfView.toFixed(0)}deg); `;
  const actors = Object.entries(scene.spatialLayout || {}).map(([name, anchor]) => `${name}: normalized center (x=${anchor.x.toFixed(2)}, y=${anchor.y.toFixed(2)}), scale=${anchor.scale.toFixed(2)}, allowed x=[${anchor.bounds.xMin.toFixed(2)},${anchor.bounds.xMax.toFixed(2)}], y=[${anchor.bounds.yMin.toFixed(2)},${anchor.bounds.yMax.toFixed(2)}], scale=[${anchor.bounds.scaleMin.toFixed(2)},${anchor.bounds.scaleMax.toFixed(2)}], ${anchor.depth}, facing ${anchor.facing}`).join(" | ");
  const objects = Object.entries(scene.objectSpatialLayout || {}).map(([name, anchor]) => `${name} FIXED OBJECT: center (x=${anchor.x.toFixed(2)}, y=${anchor.y.toFixed(2)}), apparent size=${anchor.scale.toFixed(2)}, allowed x=[${anchor.bounds.xMin.toFixed(2)},${anchor.bounds.xMax.toFixed(2)}], y=[${anchor.bounds.yMin.toFixed(2)},${anchor.bounds.yMax.toFixed(2)}], must not teleport, rotate, resize, duplicate or swap sides`).join(" | ");
  return prefix + [actors, objects].filter(Boolean).join(" || ");
}
