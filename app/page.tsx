import Link from "next/link";
import SiteNav from "./components/SiteNav";

const PIPELINE = [
  ["01", "输入剧本", "从文案开始，生成可用的分镜与镜头方向。"],
  ["02", "生成分镜", "自动拆解剧本，生成分镜节奏与画面建议。"],
  ["03", "生成资产", "从模型结果一键产出图片、视频、配音素材。"],
  ["04", "合成成片", "进编辑器预览、微调后导出完整作品。"],
];

export default function HomePage() {
  return (
    <main className="portal-home">
      <SiteNav current="home" />
      <section className="portal-hero">
        <div className="portal-hero-copy">
          <p className="portal-kicker">AI 创作工作流</p>
          <h1>
            从剧本到成片，全流程在一处完成。
            <br />
            快速创作 AI 漫剧与 AI 视频。
          </h1>
          <p>
            漫镜是完整的 AI 漫剧生产型桌面软件。你可以先写好剧情，再一站式生成分镜、素材、配音与成片，并可进一步编辑导出。
          </p>
          <div className="portal-actions">
            <Link href="/studio">进入 AI 工作台</Link>
            <Link href="/video">进入 AI 视频</Link>
            <Link href="/editor">打开剪辑编辑</Link>
          </div>
          <div className="portal-proof">
            <span><b>6</b> 个 AI 角色</span>
            <span><b>20+</b> 个模型预设</span>
            <span><b>100%</b> 本地桌面模式</span>
          </div>
        </div>
          <div className="portal-stage" aria-label="作品预览">
          <div className="portal-film">
            <div className="portal-film-head"><span>镜头 04</span><b>剧本 01</b><em>00:18</em></div>
            <div className="portal-film-scene"><i className="portal-moon" /><div className="portal-character one" /><div className="portal-character two" /><p>文本与媒体输出联动生成，实时查看片段进度。</p></div>
          </div>
          <div className="portal-mini-timeline">
            <div><b>版本 1</b><span /><span /><span /></div>
            <div><b>片段 1</b><i /><i /><i /></div>
            <div><b>特效</b><em /><em /></div>
          </div>
            <div className="portal-status"><i /><span>AI 视频引擎正在生成中</span><b>72%</b></div>
        </div>
      </section>

      <section className="portal-route-grid">
        <Link href="/studio"><span>01</span><i>01</i><div><b>AI 工作台</b><p>写剧本、生成分镜并管理项目参数。</p></div><em>进入</em></Link>
        <Link href="/video"><span>02</span><i>02</i><div><b>AI 视频</b><p>支持文本、图片、音频、视频参考，生成片段。</p></div><em>开始</em></Link>
        <Link href="/canvas"><span>03</span><i>03</i><div><b>画布</b><p>可视化排布镜头与时序，进行节奏设计。</p></div><em>打开</em></Link>
        <Link href="/editor"><span>04</span><i>04</i><div><b>编辑器</b><p>导入产出结果，微调转场与音频进行导出。</p></div><em>打开</em></Link>
        <Link href="/models"><span>05</span><i>05</i><div><b>模型中心</b><p>配置 API Key 与自定义模型，随时切换角色。</p></div><em>配置</em></Link>
        <Link href="/projects"><span>06</span><i>06</i><div><b>项目</b><p>在一个地方查看草稿、历史与成片。</p></div><em>查看</em></Link>
      </section>

      <section className="portal-pipeline">
        <div className="portal-section-title"><span>工作流程</span><h2>推荐 AI 漫剧创作路径</h2><p>从文本输入到最终渲染，一步步推进，过程可追溯。</p></div>
        <div className="portal-pipeline-list">
          {PIPELINE.map(([number, title, text]) => (
            <article key={number}><span>{number}</span><div><b>{title}</b><p>{text}</p></div><i /></article>
          ))}
        </div>
      </section>

      <section className="portal-banner">
        <div><span>立即创作</span><h2>立即体验一体化制作流程</h2></div>
        <Link href="/studio">开始新项目</Link>
      </section>

      <footer className="portal-footer">
        <Link className="global-brand" href="/">
          <span>漫</span>
          <div><b>漫镜</b><small>AI 漫剧工作台</small></div>
        </Link>
        <p>为 AI 漫剧创作者打造的本地桌面工作环境。</p>
        <div>
          <Link href="/models">模型列表</Link>
          <Link href="/editor">编辑器</Link>
          <a href="https://github.com/OpenCut-app/OpenCut" target="_blank" rel="noreferrer">参考项目：OpenCut</a>
        </div>
      </footer>
    </main>
  );
}

