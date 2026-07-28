"use client";

import { useMemo, useState } from "react";

const scenes = [
  { n: "01", time: "00:00–00:06", title: "雨夜重逢", copy: "女孩站在旧书店门口，雨水沿着霓虹灯牌落下。她抬头，看见那个消失三年的人。", color: "violet" },
  { n: "02", time: "00:06–00:13", title: "未寄出的信", copy: "男人从大衣内袋取出泛黄信封。特写：收件人一栏，写着她的名字。", color: "blue" },
  { n: "03", time: "00:13–00:20", title: "秘密揭晓", copy: "镜头环绕两人，街道的声音突然静止。他说：‘我每天都在等你回来。’", color: "amber" },
  { n: "04", time: "00:20–00:28", title: "新的开始", copy: "女孩接过信，雨停了。两人并肩走进书店，暖光从门缝里铺向街道。", color: "rose" },
];

export default function Home() {
  const [story, setStory] = useState("雨夜，女孩在即将关门的旧书店前，遇见了消失三年的恋人。他带着一封从未寄出的信，藏着两人错过彼此的真相……");
  const [style, setStyle] = useState("国漫电影感");
  const [duration, setDuration] = useState("30秒");
  const [step, setStep] = useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const chars = story.length;
  const canGenerate = chars > 8 && step !== "running";
  const statusText = useMemo(() => progress < 22 ? "正在理解故事结构" : progress < 48 ? "正在设计角色与场景" : progress < 76 ? "正在绘制动态分镜" : "正在合成配音与字幕", [progress]);

  function generate() {
    if (!canGenerate) return;
    setStep("running"); setProgress(7);
    const timer = window.setInterval(() => {
      setProgress((p) => {
        const next = Math.min(100, p + Math.ceil(Math.random() * 13));
        if (next >= 100) { window.clearInterval(timer); window.setTimeout(() => setStep("done"), 450); }
        return next;
      });
    }, 320);
  }

  return (
    <main>
      <nav className="nav">
        <a className="brand" href="#top" aria-label="漫镜工作台首页"><span className="brand-mark">M</span><span>漫镜</span><i>AI 漫剧工作台</i></a>
        <div className="nav-center"><a href="#studio">创作台</a><a href="#works">作品库</a><a href="#templates">灵感模板</a></div>
        <div className="nav-actions"><button className="icon-btn" aria-label="通知">◌<span /></button><button className="avatar">柚</button></div>
      </nav>

      <section id="top" className="hero">
        <div className="eyebrow"><span>✦</span> AI 原生漫剧创作平台</div>
        <h1>一句话，拍成一部<span>会呼吸的漫剧。</span></h1>
        <p>从灵感到成片，AI 为你完成剧本、分镜、角色、配音与剪辑。</p>
        <div className="trust"><span>无需剪辑经验</span><span>角色全程一致</span><span>最快 3 分钟成片</span></div>
      </section>

      <section id="studio" className="studio">
        <div className="studio-head">
          <div><b>01</b><span>写下你的故事</span></div>
          <span className="autosave">✓ 已自动保存</span>
        </div>
        <div className="editor-grid">
          <div className="story-box">
            <textarea value={story} onChange={(e) => setStory(e.target.value)} maxLength={600} aria-label="故事内容" placeholder="写下你的故事梗概，或粘贴已有剧本……" />
            <div className="story-bottom"><button onClick={() => setStory("深夜的末班地铁上，女孩发现对面的乘客竟是十年后的自己。车门打开前，她只有三分钟改变人生。")}>↻ 换个灵感</button><span>{chars} / 600</span></div>
          </div>
          <div className="settings">
            <label>视觉风格</label>
            <div className="chips">{["国漫电影感", "日系清新", "赛博朋克", "水墨古风"].map(x => <button key={x} onClick={() => setStyle(x)} className={style === x ? "active" : ""}>{x}</button>)}</div>
            <label>成片时长</label>
            <div className="segment">{["30秒", "60秒", "90秒"].map(x => <button key={x} onClick={() => setDuration(x)} className={duration === x ? "active" : ""}>{x}</button>)}</div>
            <div className="setting-row"><span><b>自动配音</b><small>智能匹配角色音色</small></span><button className="switch on" aria-label="自动配音开关"><i /></button></div>
            <div className="setting-row"><span><b>动态运镜</b><small>增加推拉摇移效果</small></span><button className="switch on" aria-label="动态运镜开关"><i /></button></div>
          </div>
        </div>
        <button className="generate" disabled={!canGenerate} onClick={generate}><span>✦</span>{step === "running" ? `${statusText} · ${progress}%` : step === "done" ? "重新生成漫剧" : "一键生成漫剧"}<small>{style} · {duration} · 预计消耗 12 灵感值</small></button>
        {step === "running" && <div className="progress" aria-label={`生成进度 ${progress}%`}><i style={{width: `${progress}%`}} /></div>}
      </section>

      <section id="works" className={`result ${step === "done" ? "show" : ""}`}>
        <div className="result-head"><div><span className="done">✓ 生成完成</span><h2>雨停之前，我们重逢</h2><p>4 个镜头 · 28 秒 · {style}</p></div><div className="result-actions"><button>分享</button><button className="export">导出成片 ↗</button></div></div>
        <div className="result-grid">
          <div className="player"><div className="frame"><div className="moon"/><div className="rain"/><div className="street"/><div className="person one"/><div className="person two"/><div className="subtitle">“原来，我们都没有忘记。”</div><button className="play" aria-label="播放">▶</button></div><div className="timeline"><button>▶</button><span>00:00</span><i><b /></i><span>00:28</span><button>▣</button></div></div>
          <div className="scene-list"><div className="scene-title"><b>智能分镜</b><span>可单独编辑每个镜头</span></div>{scenes.map((s, idx) => <button className={`scene ${idx===0 ? "selected" : ""}`} key={s.n}><div className={`thumb ${s.color}`}><span>{s.n}</span></div><div><b>{s.title}</b><small>{s.time}</small><p>{s.copy}</p></div><span className="more">•••</span></button>)}</div>
        </div>
      </section>

      <section id="templates" className="workflow"><span>一个故事，五步成片</span>{["理解剧本", "角色定妆", "智能分镜", "动态演绎", "配音成片"].map((x,i)=><div key={x}><i>{String(i+1).padStart(2,"0")}</i><b>{x}</b>{i<4&&<em>→</em>}</div>)}</section>
      <footer><span>漫镜创作平台</span><p>让每一个好故事，都值得被看见。</p><small>AI 生成内容仅供创作参考</small></footer>
    </main>
  );
}
