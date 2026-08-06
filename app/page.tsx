import SiteNav from "./components/SiteNav";

const PIPELINE = [
  ["01", "故事与剧本", "语言模型拆解人物、冲突、分镜和镜头提示词"],
  ["02", "角色与画面", "生图模型建立角色资产并维持跨镜头一致性"],
  ["03", "动态与声音", "视频、配音和口型模型逐镜完成真实表演"],
  ["04", "剪辑与交付", "多轨剪辑台完成节奏、字幕、混音和成片导出"],
];

export default function HomePage() {
  return <main className="portal-home">
    <SiteNav current="home" />
    <section className="portal-hero">
      <div className="portal-hero-copy">
        <p className="portal-kicker"><i /> 多 AI 协作制片系统</p>
        <h1>从一句故事，<br />到一部<em>真正会动</em>的漫剧。</h1>
        <p>漫镜把编剧、导演、生图、视频、配音和剪辑组织成一条可查看、可修改、可下载的生产线。你可以使用推荐模型，也可以接入自己的 API。</p>
        <div className="portal-actions"><a href="/studio">进入 AI 工作台 <span>→</span></a><a href="/video">自主生成 AI 视频</a><a href="/editor">打开专业剪辑台</a></div>
        <div className="portal-proof"><span><b>6</b> 个 AI 岗位</span><span><b>0–120s</b> 自定义时长</span><span><b>100%</b> 素材可下载</span></div>
      </div>
      <div className="portal-stage" aria-label="漫剧制作流程预览">
        <div className="portal-film"><div className="portal-film-head"><span>SCENE 04</span><b>雨夜 · 旧书店</b><em>00:18</em></div><div className="portal-film-scene"><i className="portal-moon" /><div className="portal-character one" /><div className="portal-character two" /><p>“这一次，别再错过了。”</p></div></div>
        <div className="portal-mini-timeline"><div><b>V1</b><span /><span /><span /></div><div><b>A1</b><i /><i /><i /></div><div><b>字幕</b><em /><em /></div></div>
        <div className="portal-status"><i /><span>视频 AI 正在生成镜头表演</span><b>72%</b></div>
      </div>
    </section>

    <section className="portal-route-grid">
      <a href="/studio"><span>01</span><i>创</i><div><b>AI 工作台</b><p>输入故事，配置六个 AI 岗位，查看每一步制作进度。</p></div><em>打开 →</em></a>
      <a href="/video"><span>02</span><i>影</i><div><b>自主视频</b><p>不走漫剧流水线，使用文字与全能参考直接生成 AI 视频。</p></div><em>生成 →</em></a>
      <a href="/canvas"><span>03</span><i>板</i><div><b>制片画布</b><p>用可拖拽、可连线的节点组织剧本、角色、分镜与素材。</p></div><em>编排 →</em></a>
      <a href="/editor"><span>04</span><i>剪</i><div><b>专业剪辑台</b><p>导入视频、图片和音频，完成分割、字幕、调色与导出。</p></div><em>打开 →</em></a>
      <a href="/models"><span>05</span><i>模</i><div><b>模型与 Key</b><p>选择即梦、LibTV、Pollinations 或本地开源模型。</p></div><em>配置 →</em></a>
      <a href="/projects"><span>06</span><i>库</i><div><b>项目资产</b><p>集中管理剧本、角色图、分镜、视频和工程文件。</p></div><em>查看 →</em></a>
    </section>

    <section className="portal-pipeline">
      <div className="portal-section-title"><span>WORKFLOW</span><h2>每一步都看得见，每个结果都拿得走</h2><p>不是一个黑盒按钮，而是一套能人工介入的制片流程。</p></div>
      <div className="portal-pipeline-list">{PIPELINE.map(([number, title, text]) => <article key={number}><span>{number}</span><div><b>{title}</b><p>{text}</p></div><i /></article>)}</div>
    </section>

    <section className="portal-banner"><div><span>READY TO DIRECT</span><h2>你的故事，应该被认真拍出来。</h2></div><a href="/studio">创建第一部漫剧 <span>↗</span></a></section>
    <footer className="portal-footer"><a className="global-brand" href="/"><span>漫</span><div><b>漫镜</b><small>AI MOTION STUDIO</small></div></a><p>多 AI 协作生成、剪辑与交付工作台</p><div><a href="/models">接入模型</a><a href="/editor">剪辑台</a><a href="https://github.com/OpenCut-app/OpenCut" target="_blank" rel="noreferrer">开源参考</a></div></footer>
  </main>;
}
