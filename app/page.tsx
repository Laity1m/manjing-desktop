"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Scene = { title: string; text: string; dialogue: string; duration: number; palette: string };
const palettes = ["violet", "blue", "amber", "rose"];
const defaults: Scene[] = [
  { title: "雨夜重逢", text: "女孩站在旧书店门口，雨水沿着霓虹灯牌落下。她抬头，看见那个消失三年的人。", dialogue: "你终于回来了。", duration: 7, palette: "violet" },
  { title: "未寄出的信", text: "男人从大衣内袋取出一封泛黄的信。收件人一栏，写着她的名字。", dialogue: "这封信，我写了三年。", duration: 7, palette: "blue" },
  { title: "秘密揭晓", text: "整条街忽然安静下来。他终于说出了两人错过彼此的真相。", dialogue: "我每天都在等你回来。", duration: 7, palette: "amber" },
  { title: "新的开始", text: "女孩接过信，雨停了。两人并肩走进书店，暖光铺向街道。", dialogue: "原来，我们都没有忘记。", duration: 7, palette: "rose" },
];

function makeScenes(input: string, seconds: number): Scene[] {
  const parts = input.split(/[。！？!?；;\n]+/).map(x => x.trim()).filter(Boolean);
  const seeds = parts.length ? parts : [input];
  const count = Math.min(6, Math.max(3, Math.ceil(seconds / 10)));
  const titles = ["故事开场", "意外发生", "线索浮现", "冲突升级", "真相揭晓", "故事终章"];
  return Array.from({ length: count }, (_, i) => {
    const text = seeds[i % seeds.length] || "故事继续发展。";
    const quote = text.match(/[“\"]([^”\"]+)[”\"]/)?.[1] || (i === count - 1 ? "故事，才刚刚开始。" : text.slice(0, 18));
    return { title: titles[i], text, dialogue: quote, duration: Math.max(4, Math.round(seconds / count)), palette: palettes[i % palettes.length] };
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number) {
  let row = ""; let yy = y;
  for (const char of text) { const next = row + char; if (ctx.measureText(next).width > max) { ctx.fillText(row, x, yy); row = char; yy += line; } else row = next; }
  if (row) ctx.fillText(row, x, yy);
}

export default function Home() {
  const [story, setStory] = useState("雨夜，女孩在即将关门的旧书店前，遇见了消失三年的恋人。他带着一封从未寄出的信，藏着两人错过彼此的真相……");
  const [style, setStyle] = useState("国漫电影感");
  const [duration, setDuration] = useState(30);
  const [voice, setVoice] = useState(true);
  const [motion, setMotion] = useState(true);
  const [scenes, setScenes] = useState<Scene[]>(defaults);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("done");
  const [progress, setProgress] = useState(100);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const spoken = useRef(-1);
  const total = scenes.reduce((n, s) => n + s.duration, 0);
  const offsets = useMemo(() => scenes.map((_, i) => scenes.slice(0, i).reduce((n, s) => n + s.duration, 0)), [scenes]);

  useEffect(() => { const saved = localStorage.getItem("manjing-project"); if (saved) { try { const p = JSON.parse(saved); if (p.story) setStory(p.story); if (p.scenes) setScenes(p.scenes); } catch {} } }, []);
  useEffect(() => { localStorage.setItem("manjing-project", JSON.stringify({ story, scenes })); }, [story, scenes]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTime(t => t >= total ? (setPlaying(false), 0) : Math.min(total, t + .1)), 100);
    return () => window.clearInterval(id);
  }, [playing, total]);
  useEffect(() => {
    const idx = Math.min(scenes.length - 1, offsets.findIndex((o, i) => time >= o && time < o + scenes[i].duration));
    const next = idx < 0 ? scenes.length - 1 : idx; setCurrent(next);
    if (playing && voice && spoken.current !== next && "speechSynthesis" in window) {
      window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(scenes[next].dialogue); u.lang = "zh-CN"; u.rate = .95; window.speechSynthesis.speak(u); spoken.current = next;
    }
  }, [time, offsets, scenes, playing, voice]);
  useEffect(() => { if (!playing && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, [playing]);

  function flash(msg: string) { setNotice(msg); window.setTimeout(() => setNotice(""), 2300); }
  function generate() {
    if (story.trim().length < 8 || phase === "running") return;
    setPhase("running"); setProgress(6); setPlaying(false); setTime(0);
    const id = window.setInterval(() => setProgress(p => { const n = Math.min(100, p + 8 + Math.round(Math.random() * 10)); if (n >= 100) { window.clearInterval(id); setScenes(makeScenes(story, duration)); setPhase("done"); flash("漫剧已生成，可以立即播放"); } return n; }), 260);
  }
  function seek(value: number) { const t = value / 100 * total; setTime(t); spoken.current = -1; }
  function selectScene(i: number) { setCurrent(i); setTime(offsets[i]); setPlaying(false); spoken.current = -1; }
  function editScene(i: number) { const next = window.prompt("编辑该镜头的画面描述：", scenes[i].text); if (next?.trim()) setScenes(s => s.map((x, n) => n === i ? { ...x, text: next.trim() } : x)); }
  async function share() { const url = location.href.split("#")[0]; try { if (navigator.share) await navigator.share({ title: "我的漫剧", text: story.slice(0, 60), url }); else { await navigator.clipboard.writeText(url); flash("作品链接已复制"); } } catch {} }
  async function exportVideo() {
    if (!("MediaRecorder" in window)) return flash("当前浏览器暂不支持视频导出");
    setExporting(true); setPlaying(false); const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 540;
    const ctx = canvas.getContext("2d")!; const stream = canvas.captureStream(24); const chunks: Blob[] = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime }); rec.ondataavailable = e => e.data.size && chunks.push(e.data); rec.start();
    for (let i = 0; i < scenes.length; i++) { const s = scenes[i]; for (let f = 0; f < 28; f++) { const g = ctx.createLinearGradient(0,0,960,540); const cs = s.palette === "violet" ? ["#171126","#7655a8"] : s.palette === "blue" ? ["#0b2138","#406e92"] : s.palette === "amber" ? ["#261717","#b06c3e"] : ["#2b1222","#a94e6c"]; g.addColorStop(0,cs[0]); g.addColorStop(1,cs[1]); ctx.fillStyle=g;ctx.fillRect(0,0,960,540); ctx.fillStyle="rgba(255,255,255,.08)"; for(let r=0;r<18;r++)ctx.fillRect((r*73+f*8)%1000,r*37%400,2,90); ctx.fillStyle="#fff";ctx.font="700 36px Microsoft YaHei";ctx.fillText(s.title,56,72);ctx.font="23px Microsoft YaHei";ctx.fillStyle="rgba(255,255,255,.82)";wrapText(ctx,s.text,56,125,820,38);ctx.fillStyle="rgba(5,3,10,.72)";ctx.fillRect(0,444,960,96);ctx.fillStyle="#fff";ctx.font="25px Microsoft YaHei";ctx.textAlign="center";ctx.fillText(`“${s.dialogue}”`,480,499);ctx.textAlign="left"; await new Promise(r=>setTimeout(r,35)); } }
    await new Promise(r=>setTimeout(r,120)); rec.stop(); await new Promise<void>(r => rec.onstop = () => r()); const blob = new Blob(chunks,{type:mime}); const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`漫镜-${Date.now()}.webm`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);setExporting(false);flash("视频已导出到下载目录");
  }
  const scene = scenes[current] || defaults[0];

  return <main>
    {notice && <div className="toast">✓ {notice}</div>}
    <nav className="nav"><a className="brand" href="#top"><span className="brand-mark">M</span><span>漫镜</span><i>AI 漫剧工作台</i></a><div className="nav-center"><a href="#studio">创作台</a><a href="#works">当前作品</a><a href="#templates">创作流程</a></div><div className="nav-actions"><button className="icon-btn" onClick={()=>flash("暂无新通知")}>◌<span /></button><button className="avatar" onClick={()=>flash("项目已自动保存在本机")}>柚</button></div></nav>
    <section id="top" className="hero"><div className="eyebrow"><span>✦</span> AI 原生漫剧创作平台</div><h1>一句话，拍成一部<span>会呼吸的漫剧。</span></h1><p>输入故事，自动拆分分镜；播放、配音、编辑和导出都能直接使用。</p><div className="trust"><span>本地即时生成</span><span>自动中文配音</span><span>支持视频导出</span></div></section>
    <section id="studio" className="studio"><div className="studio-head"><div><b>01</b><span>写下你的故事</span></div><span className="autosave">✓ 已自动保存到本机</span></div><div className="editor-grid"><div className="story-box"><textarea value={story} onChange={e=>setStory(e.target.value)} maxLength={600}/><div className="story-bottom"><button onClick={()=>setStory("深夜的末班地铁上，女孩发现对面的乘客竟是十年后的自己。车门打开前，她只有三分钟改变人生。")}>↻ 换个灵感</button><span>{story.length} / 600</span></div></div><div className="settings"><label>视觉风格</label><div className="chips">{["国漫电影感","日系清新","赛博朋克","水墨古风"].map(x=><button key={x} className={style===x?"active":""} onClick={()=>setStyle(x)}>{x}</button>)}</div><label>成片时长</label><div className="segment">{[30,60,90].map(x=><button key={x} className={duration===x?"active":""} onClick={()=>setDuration(x)}>{x}秒</button>)}</div><div className="setting-row"><span><b>自动配音</b><small>使用系统中文语音朗读台词</small></span><button onClick={()=>setVoice(v=>!v)} className={`switch ${voice?"on":""}`}><i/></button></div><div className="setting-row"><span><b>动态运镜</b><small>播放时增加镜头运动</small></span><button onClick={()=>setMotion(v=>!v)} className={`switch ${motion?"on":""}`}><i/></button></div></div></div><button className="generate" onClick={generate} disabled={story.trim().length<8||phase==="running"}><span>✦</span>{phase==="running"?`正在生成分镜 · ${progress}%`:"一键生成漫剧"}<small>{style} · {duration}秒 · 本地免费生成</small></button>{phase==="running"&&<div className="progress"><i style={{width:`${progress}%`}}/></div>}</section>
    <section id="works" className="result show"><div className="result-head"><div><span className="done">✓ 可播放作品</span><h2>{scenes[0]?.title} · AI 漫剧</h2><p>{scenes.length} 个镜头 · {total} 秒 · {style}</p></div><div className="result-actions"><button onClick={share}>分享作品</button><button className="export" onClick={exportVideo} disabled={exporting}>{exporting?"正在导出…":"导出视频 ↗"}</button></div></div><div className="result-grid"><div className="player"><div className={`frame live ${scene.palette} ${playing&&motion?"moving":""}`}><div className="moon"/><div className="rain"/><div className="street"/><div className="person one"/><div className="person two"/><div className="scene-copy"><b>{scene.title}</b><p>{scene.text}</p></div><div className="subtitle">“{scene.dialogue}”</div><button className="play" onClick={()=>{spoken.current=-1;setPlaying(p=>!p)}}>{playing?"Ⅱ":"▶"}</button></div><div className="timeline"><button onClick={()=>setPlaying(p=>!p)}>{playing?"Ⅱ":"▶"}</button><span>{Math.floor(time/60).toString().padStart(2,"0")}:{Math.floor(time%60).toString().padStart(2,"0")}</span><input aria-label="播放进度" type="range" min="0" max="100" value={total?time/total*100:0} onChange={e=>seek(Number(e.target.value))}/><span>00:{total.toString().padStart(2,"0")}</span><button onClick={()=>{setTime(0);setPlaying(false)}}>↺</button></div></div><div className="scene-list"><div className="scene-title"><b>智能分镜</b><span>点击镜头预览 · 双击编辑</span></div>{scenes.map((s,i)=><button onClick={()=>selectScene(i)} onDoubleClick={()=>editScene(i)} className={`scene ${current===i?"selected":""}`} key={i}><div className={`thumb ${s.palette}`}><span>{String(i+1).padStart(2,"0")}</span></div><div><b>{s.title}</b><small>{offsets[i]}–{offsets[i]+s.duration}秒</small><p>{s.text}</p></div><span className="more" onClick={e=>{e.stopPropagation();editScene(i)}}>•••</span></button>)}</div></div></section>
    <section id="templates" className="workflow"><span>一个故事，五步成片</span>{["理解剧本","生成分镜","中文配音","动态播放","导出视频"].map((x,i)=><div key={x}><i>{String(i+1).padStart(2,"0")}</i><b>{x}</b>{i<4&&<em>→</em>}</div>)}</section><footer><span>漫镜创作平台</span><p>让每一个好故事，都值得被看见。</p><small>浏览器本地生成，不上传你的故事</small></footer>
  </main>;
}
