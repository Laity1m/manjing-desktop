"use client";

import { useState, type PointerEvent } from "react";
import { defaultStageLayout, projectStageLayout, projectStageObjects, type StageLayout } from "../lib/spatial-continuity";

type Props = { characters: string[]; objects?: string[]; value?: StageLayout; onChange: (layout: StageLayout) => void; onApplyToEnvironment?: (layout: StageLayout) => void };

function clamp(value: number) { return Math.max(0.04, Math.min(0.96, value)); }

export default function StageLayoutEditor({ characters, objects = [], value, onChange, onApplyToEnvironment }: Props) {
  const [newObjectName, setNewObjectName] = useState("");
  const actorDrafts = defaultStageLayout(characters).actors;
  const layout = value ? { ...value, version: 2 as const, actors: { ...actorDrafts, ...(value.actors || {}) }, objects: { ...(value.objects || {}) } } : defaultStageLayout(characters);
  const projected = projectStageLayout(layout);
  const projectedObjects = projectStageObjects(layout);
  const move = (kind: "actor" | "object" | "camera", name: string, event: PointerEvent<HTMLElement>) => {
    const surface = event.currentTarget.closest(".stage-map") as HTMLElement | null;
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
  const removeObject = (name: string) => {
    const nextObjects = { ...layout.objects };
    delete nextObjects[name];
    onChange({ ...layout, objects: nextObjects });
  };
  const clearObjects = () => onChange({ ...layout, objects: {} });
  return <section className="stage-layout-editor">
    <header><div><b>2.5D 顶视舞台走位</b><small>{layout.enabled && layout.confirmed ? "已确认：本镜生成会使用这些坐标" : "未确认草稿：默认位置不会传给视频模型"}</small></div><div className="stage-layout-actions"><button type="button" className={layout.enabled && layout.confirmed ? "on" : ""} onClick={() => onChange({ ...layout, enabled: !(layout.enabled && layout.confirmed), confirmed: !(layout.enabled && layout.confirmed) })}>{layout.enabled && layout.confirmed ? "停用位置约束" : "确认并启用本镜布局"}</button>{layout.enabled && layout.confirmed && onApplyToEnvironment ? <button type="button" onClick={() => onApplyToEnvironment(layout)}>同步到同场景后续镜头</button> : null}<button type="button" disabled={!layout.enabled || !layout.confirmed} className={layout.frozen ? "on" : ""} onClick={() => onChange({ ...layout, frozen: !layout.frozen })}>{layout.frozen ? "坐标已冻结" : "允许镜头重排"}</button></div></header>
    <div className="stage-map">
      <div className="stage-grid" />
      {characters.map((name) => { const actor = layout.actors[name] || defaultStageLayout(characters).actors[name]; return <button type="button" className="stage-actor" key={name} style={{ left: `${actor.x * 100}%`, top: `${actor.y * 100}%`, transform: `translate(-50%,-50%) rotate(${actor.facing}deg)` }} onPointerDown={(event) => move("actor", name, event)} title={`拖动 ${name}`}><i>▲</i><span style={{ transform: `rotate(${-actor.facing}deg)` }}>{name}</span></button>; })}
      {Object.entries(layout.objects).map(([name, object]) => <div className="stage-object-node" key={name} style={{ left: `${object.x * 100}%`, top: `${object.y * 100}%` }}><button type="button" className="stage-object" style={{ transform: `rotate(${object.facing}deg) scale(${object.size})` }} onPointerDown={(event) => move("object", name, event)} title={`拖动固定物体 ${name}`}><i>◆</i><span style={{ transform: `rotate(${-object.facing}deg) scale(${1 / object.size})` }}>{name}</span></button><button type="button" className="stage-object-delete" aria-label={`删除固定物 ${name}`} title={`删除 ${name}`} onClick={(event) => { event.stopPropagation(); removeObject(name); }}>×</button></div>)}
      <button type="button" className="stage-camera" style={{ left: `${layout.camera.x * 100}%`, top: `${layout.camera.y * 100}%`, transform: `translate(-50%,-50%) rotate(${layout.camera.angle + 90}deg)` }} onPointerDown={(event) => move("camera", "", event)} title="拖动相机"><i>▰</i><span>相机</span></button>
      <div className="camera-ray" style={{ left: `${layout.camera.x * 100}%`, top: `${layout.camera.y * 100}%`, transform: `rotate(${layout.camera.angle}deg)` }} />
    </div>
    <div className="stage-controls"><label>相机方向 <input type="range" min={-180} max={180} value={layout.camera.angle} onChange={(event) => patchCamera({ angle: Number(event.target.value) })} /><b>{layout.camera.angle}°</b></label><label>视场角 <input type="range" min={25} max={100} value={layout.camera.fieldOfView} onChange={(event) => patchCamera({ fieldOfView: Number(event.target.value) })} /><b>{layout.camera.fieldOfView}°</b></label><label>俯仰近似 <input type="range" min={0} max={0.8} step={0.05} value={layout.camera.elevation} onChange={(event) => patchCamera({ elevation: Number(event.target.value) })} /><b>{layout.camera.elevation.toFixed(2)}</b></label></div>
    <div className="stage-object-tools"><input value={newObjectName} onChange={(event) => setNewObjectName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addObject(); } }} placeholder="仅添加影响走位的固定物，如门、床、固定书桌" /><button type="button" onClick={addObject}>添加固定物</button>{Object.keys(layout.objects).length > 0 ? <button type="button" className="clear" onClick={clearObjects}>清空固定物</button> : null}</div>
    {objects.filter((name) => !layout.objects[name]).length > 0 ? <div className="stage-object-suggestions"><small>剧本明确标注的固定物（不会自动加入）：</small>{objects.filter((name) => !layout.objects[name]).map((name) => <button type="button" key={name} onClick={() => onChange({ ...layout, objects: { ...layout.objects, [name]: { x: 0.5, y: 0.3, facing: 180, size: 1 } } })}>＋ {name}</button>)}</div> : null}
    <div className="stage-projection">{characters.map((name) => <span key={name}><b>{name}</b> x {projected[name]?.x.toFixed(2) || "--"} · y {projected[name]?.y.toFixed(2) || "--"} · scale {projected[name]?.scale.toFixed(2) || "--"}</span>)}{Object.keys(layout.objects).map((name) => <span className="object" key={name}><b>{name}</b> x {projectedObjects[name]?.x.toFixed(2) || "--"} · y {projectedObjects[name]?.y.toFixed(2) || "--"} · size {projectedObjects[name]?.scale.toFixed(2) || "--"}<button type="button" aria-label={`删除固定物 ${name}`} onClick={() => removeObject(name)}>×</button></span>)}</div>
    <p className="stage-limit-note">只有点击“确认并启用本镜布局”后，人物、固定物体和相机坐标才会写入全能参考提示词。服装、盆、餐具和手持道具不属于固定舞台物，不会自动摆放；它们仍按当前镜头剧情作为普通资产引用。</p>
  </section>;
}
