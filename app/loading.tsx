export default function Loading() {
  return <main className="route-loading" aria-live="polite" aria-label="正在打开页面">
    <div className="route-loading-mark"><i /><i /><i /></div>
    <p>正在打开工作区</p>
    <span>仅加载当前页面需要的功能</span>
  </main>;
}
