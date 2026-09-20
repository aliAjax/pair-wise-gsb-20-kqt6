// 版本链与冲突记录面板。

import { DomainState, RULE_TEXT, slideOf, versionsOf } from "./domain";
import { SlideStatusBadge, VersionStatusBadge, fmtTime } from "./ui";

export function VersionChain({
  state,
  slideId,
}: {
  state: DomainState;
  slideId: string | null;
}) {
  if (!slideId) {
    return <p className="muted-text">在切片登记表中点击「版本链」查看某张切片的判读历史。</p>;
  }
  const slide = slideOf(state, slideId);
  const versions = versionsOf(state, slideId);
  const children = state.slides.filter((s) => s.restainOf === slideId);

  return (
    <div className="version-chain">
      <div className="chain-summary">
        <strong>{slide.id}</strong>
        <span>
          {slide.organ} · {slide.thicknessUm} μm · 批次 {slide.batchId}
        </span>
        <SlideStatusBadge status={slide.status} />
        {slide.restainOf && <span className="sub-tag">由 {slide.restainOf} 重染而来</span>}
        {children.map((c) => (
          <span key={c.id} className="sub-tag">
            重染产生 {c.id}（批次 {c.batchId}）
          </span>
        ))}
      </div>
      {versions.length === 0 ? (
        <p className="muted-text">尚无判读版本。</p>
      ) : (
        <ol className="chain-list">
          {versions.map((v) => (
            <li key={v.id} className={`chain-item version-${v.status}`}>
              <div className="chain-head">
                <span className="version-no">v{v.versionNo}</span>
                <span className="chip">{v.kind === "initial" ? "判读" : "复核"}</span>
                <VersionStatusBadge status={v.status} />
                <span className="muted-text">
                  批次 {v.batchId} · {fmtTime(v.createdAt)}
                </span>
              </div>
              <p className="chain-conclusion">{v.conclusion}</p>
              {v.reason && <p className="chain-reason">复核原因：{v.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ConflictList({ state }: { state: DomainState }) {
  if (state.conflicts.length === 0) {
    return <p className="muted-text">暂无冲突记录。触发规则的状态变更会在此列出。</p>;
  }
  const sorted = [...state.conflicts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="table-wrap">
      <table className="conflict-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>切片编号</th>
            <th>批次</th>
            <th>触发规则</th>
            <th>字段</th>
            <th>原值</th>
            <th>新值</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id}>
              <td>{fmtTime(c.createdAt)}</td>
              <td>
                <strong>{c.slideId}</strong>
              </td>
              <td>{c.batchId}</td>
              <td>
                <span className="rule-tag" title={RULE_TEXT[c.rule]}>
                  {c.rule}
                </span>
              </td>
              <td>{c.field}</td>
              <td>{c.oldValue}</td>
              <td>{c.newValue}</td>
              <td>{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
