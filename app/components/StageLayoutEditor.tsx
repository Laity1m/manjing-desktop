"use client";

import { useState, type PointerEvent } from "react";
import { defaultStageLayout, projectStageLayout, projectStageObjects, type StageLayout } from "../lib/spatial-continuity";

type Props = { characters: string[]; objects?: string[]; value?: StageLayout; onChange: (layout: StageLayout) => void };

function clamp(value: number) { return Math.max(0.04, Math.min(0.96, value)); }

export default function StageLayoutEditor({ characters, objects = [], value, onChange }: Props) {
  const [newObjectName, setNewObjectName] = useState("");
  const inferredObjects = defaultStageLayout([], objects).objects;
  const layout = value ? { ...value, objects: { ...inferredObjects, ...(value.objects || {}) } } : defaultStageLayout(characters, objects);
  const projected = projectStageLayout(layout);
  const projectedObjects = projectStageObjects(layout);
  const move = (kind: "actor" | "object" | "camera", name: string, event: PointerEvent<HTMLElement>) => {
    const surface = event.currentTarget.parentElement;
    if (!surface) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const update = (clientX: number, clientY: number) => {
      const rect = surface.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / rect.width);
      const y = clamp((clientY - rect.top) / rect.height);
      if (kind === "camera") onChange({ ...layout, camera: { ...layout.camera, x, y } });
      else if (kind === "actor") onChange({ ...layout, actors: { ...layout.actors, [name]: { ...(layout.actors[name] || { facing: 180 }), x, y } } });
      else onChange({ ...layout, objects: { ...layout.objects, [name]: { ...(layout.objects[name] || { facing: 180, size: 1 }), x, y } } });
    };
    update(event.clientX, event.clientY);
    const target = event.currentTarget;
    target.onpointermove = (next) => update(next.clientX, next.clientY);
    target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; };
  };
  const patchCamera = (patch: Partial<StageLayout["camera"]>) => onChange({ ...layout, camera: { ...layout.camera, ...patch } });
  const addObject = () => {
    const name = newObjectName.trim();
    if (!name || layout.objects[name]) return;
    onChange({ ...layout, objects: { ...layout.objects, [name]: { x: 0.5, y: 0.3, facing: 180, size: 1 } } });
    setNewObjectName("");
  };
  return <section className="stage-layout-editor">
    <header><div><b>2.5D 顶视舞台走位</b><small>同时锁定人物、固定物体和相机；系统自动投影为最终画面坐标</small></div><button type="button" className={layout.frozen ? "on" : ""} onClick={() => onChange({ ...layout, frozen: !layout.frozen })}>{layout.frozen ? "人物与物体已冻结" : "允许镜头重排"}</button></header>
    <div className="stage-map">
      <div className="stage-grid" />
      {characters.map((name) => { const actor = layout.actors[name] || defaultStageLayout(characters).actors[name]; return <button type="button" className="stage-actor" key={name} style={{ left: `${actor.x * 100}%`, top: `${actor.y * 100}%`, transform: `translate(-50%,-50%) rotate(${actor.facing}deg)` }} onPointerDown={(event) => move("actor", name, event)} title={`拖动 ${name}`}><i>▲</i><span style={{ transform: `rotate(${-actor.facing}deg)` }}>{name}</span></button>; })}
      {Object.entries(layout.objects).map(([name, object]) => <button type="button" className="stage-object" key={name} style={{ left: `${object.x * 100}%`, top: `${object.y * 100}%`, transform: `translate(-50%,-50%) rotate(${object.facing}deg) scale(${object.size})` }} onPointerDown={(event) => move("object", name, event)} title={`拖动固定物体 ${name}`}><i>◆</i><span style={{ transform: `rotate(${-object.facing}deg) scale(${1 / object.size})` }}>{name}</span></button>)}
      <button type="button" className="stage-camera" style={{ left: `${layout.camera.x * 100}%`, top: `${layout.camera.y * 100}%`, transform: `translate(-50%,-50%) rotate(${layout.camera.angle + 90}deg)` }} onPointerDown={(event) => move("camera", "", event)} title="拖动相机"><i>▰</i><span>相机</span></button>
      <div className="camera-ray" style={{ left: `${layout.camera.x * 100}%`, top: `${layout.camera.y * 100}%`, transform: `rotate(${layout.camera.angle}deg)` }} />
    </div>
    <div className="stage-controls"><label>相机方向 <input type="range" min={-180} max={180} value={layout.camera.angle} onChange={(event) => patchCamera({ angle: Number(event.target.value) })} /><b>{layout.camera.angle}°</b></label><label>视场角 <input type="range" min={25} max={100} value={layout.camera.fieldOfView} onChange={(event) => patchCamera({ fieldOfView: Number(event.target.value) })} /><b>{layout.camera.fieldOfView}°</b></label><label>俯仰近似 <input type="range" min={0} max={0.8} step={0.05} value={layout.camera.elevation} onChange={(event) => patchCamera({ elevation: Number(event.target.value) })} /><b>{layout.camera.elevation.toFixed(2)}</b></label></div>
    <div className="stage-object-tools"><input value={newObjectName} onChange={(event) => setNewObjectName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addObject(); } }} placeholder="添加固定物体，如：书桌、门、床" /><button type="button" onClick={addObject}>添加物体锚点</button></div>
    <div className="stage-projection">{characters.map((name) => <span key={name}><b>{name}</b> x {projected[name]?.x.toFixed(2) || "--"} · y {projected[name]?.y.toFixed(2) || "--"} · scale {projected[name]?.scale.toFixed(2) || "--"}</span>)}{Object.keys(layout.objects).map((name) => <span className="object" key={name}><b>{name}</b> x {projectedObjects[name]?.x.toFixed(2) || "--"} · y {projectedObjects[name]?.y.toFixed(2) || "--"} · size {projectedObjects[name]?.scale.toFixed(2) || "--"}<button type="button" onClick={() => { const objects = { ...layout.objects }; delete objects[name]; onChange({ ...layout, objects }); }}>×</button></span>)}</div>
    <p className="stage-limit-note">轻量模式把人物、固定物体和相机的数学坐标写入全能参考提示词，不生成 3D 参考图；上一镜已批准生成视频的真实解码尾帧只用于生成不同景别/角度的备选机位，下一镜引用用户选中的备选画面，不直接照抄尾帧构图，也不启用 first_frame/last_frame 控制。</p>
  </section>;
}
