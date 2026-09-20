// 侧栏：切片登记表单与染色批次面板。

import { useState } from "react";
import { DomainState, OrganSite } from "./domain";
import { BatchStatusBadge, fmtTime, toLocalInputValue } from "./ui";
import { ORGAN_SITES } from "./SlideTable";

export interface RegisterInput {
  organ: OrganSite;
  thicknessUm: number;
  batchId: string;
  coverslippedAt: string;
}

export function RegisterForm({
  state,
  nowIso,
  onRegister,
}: {
  state: DomainState;
  nowIso: string;
  onRegister: (input: RegisterInput) => void;
}) {
  const [organ, setOrgan] = useState<OrganSite>("肝");
  const [thickness, setThickness] = useState("5");
  const [batchId, setBatchId] = useState(state.batches[0]?.id ?? "");
  const [coverslippedAt, setCoverslippedAt] = useState(toLocalInputValue(nowIso));

  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        onRegister({ organ, thicknessUm: Number(thickness), batchId, coverslippedAt });
      }}
    >
      <label>
        <span>部位</span>
        <select value={organ} onChange={(e) => setOrgan(e.target.value as OrganSite)}>
          {ORGAN_SITES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>厚度（μm，2–8）</span>
        <input
          required
          type="number"
          min={2}
          max={8}
          step="0.5"
          value={thickness}
          onChange={(e) => setThickness(e.target.value)}
        />
      </label>
      <label>
        <span>染色批次</span>
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {state.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.id} · {b.stain}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>封片时间</span>
        <input
          required
          type="datetime-local"
          value={coverslippedAt}
          onChange={(e) => setCoverslippedAt(e.target.value)}
        />
      </label>
      <button type="submit" className="primary-action">
        登记切片（编号自动生成）
      </button>
    </form>
  );
}

export function BatchPanel({
  state,
  onRelease,
  onCreateBatch,
}: {
  state: DomainState;
  onRelease: (batchId: string) => void;
  onCreateBatch: (input: { stain: string; note: string }) => void;
}) {
  const [stain, setStain] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="batch-panel">
      <div className="batch-list">
        {state.batches.map((batch) => {
          const slideCount = state.slides.filter((s) => s.batchId === batch.id).length;
          return (
            <article key={batch.id} className="batch-card">
              <div className="batch-head">
                <strong>{batch.id}</strong>
                <BatchStatusBadge status={batch.status} />
              </div>
              <p>
                {batch.stain} · {slideCount} 张切片
              </p>
              <p className="muted-text">
                配制 {fmtTime(batch.preparedAt)}
                {batch.releasedAt ? ` · 放行 ${fmtTime(batch.releasedAt)}` : ""}
                {batch.supersedes ? ` · 替换 ${batch.supersedes}` : ""}
              </p>
              <p className="muted-text">{batch.note}</p>
              {batch.status === "pending_release" && (
                <button onClick={() => onRelease(batch.id)}>质控放行</button>
              )}
            </article>
          );
        })}
      </div>
      <form
        className="stack-form compact"
        onSubmit={(e) => {
          e.preventDefault();
          onCreateBatch({ stain, note });
          setStain("");
          setNote("");
        }}
      >
        <label>
          <span>新建批次 · 染色方法</span>
          <input
            required
            placeholder="如：HE 染色"
            value={stain}
            onChange={(e) => setStain(e.target.value)}
          />
        </label>
        <label>
          <span>备注</span>
          <input
            placeholder="配制说明（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button type="submit">新建批次（待放行）</button>
      </form>
    </div>
  );
}
