import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  addConclusion,
  audit,
  gateBlocks,
  loadState,
  markUnqualified,
  MOUNT_MIN_HOURS,
  restain,
  saveState,
  seedState,
  STATUS_LABEL,
  STORAGE_KEY,
  THICKNESS_MAX,
  THICKNESS_MIN,
  type AppState,
  type Slide,
} from "./domain";

const RESULT_OPTIONS = ["未见异常", "炎性改变", "细胞异型", "疑似肿瘤", "其他"];

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const fmtAgo = (ts: number, now: number) => {
  const h = (now - ts) / 3600_000;
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.max(1, Math.round(h * 60))}min`;
};

const toLocalInput = (ts: number) => {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

type Action =
  | { type: "interpret"; slideId: string }
  | { type: "review"; slideId: string };

function App() {
  const [state, setState] = useState<AppState>(() => loadState() ?? seedState(Date.now()));
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 登记表单
  const [form, setForm] = useState(() => ({
    id: "", site: "", thickness: "4", batchId: "", mountedAt: toLocalInput(Date.now()),
  }));
  // 新建批次表单
  const [batchForm, setBatchForm] = useState({ id: "", stain: "HE 染色" });
  // 判读/复核表单
  const [conclForm, setConclForm] = useState({ result: RESULT_OPTIONS[0], note: "", reason: "" });

  useEffect(() => {
    saveState(state);
  }, [state]);

  const now = useMemo(() => Date.now(), [tick, state]);
  const conflicts = useMemo(() => audit(state, now), [state, now]);
  const batchById = useMemo(() => new Map(state.batches.map((b) => [b.id, b])), [state.batches]);

  const selected = state.slides.find((s) => s.id === selectedId) ?? null;
  const actionSlide = action ? state.slides.find((s) => s.id === action.slideId) ?? null : null;

  const metrics = [
    { label: "切片总数", value: String(state.slides.length) },
    { label: "待复核", value: String(state.slides.filter((s) => s.status === "review").length) },
    { label: "已放行批次", value: `${state.batches.filter((b) => b.released).length}/${state.batches.length}` },
    { label: "当前冲突", value: String(conflicts.length) },
  ];

  const say = (kind: "ok" | "err", text: string) => setNotice({ kind, text });

  /* ---------- 事件 ---------- */

  const submitSlide = () => {
    const id = form.id.trim();
    const thickness = Number(form.thickness);
    const mountedAt = new Date(form.mountedAt).getTime();
    if (!id) return say("err", "请填写切片编号");
    if (state.slides.some((s) => s.id === id)) return say("err", `编号 ${id} 已存在`);
    if (!form.site.trim()) return say("err", "请填写取材部位");
    if (!Number.isFinite(thickness) || thickness <= 0) return say("err", "厚度须为正数（μm）");
    if (!form.batchId) return say("err", "请选择染色批次");
    if (!Number.isFinite(mountedAt)) return say("err", "请填写封片时间");
    if (mountedAt > now) return say("err", "封片时间不能晚于当前时间");

    const slide: Slide = {
      id, site: form.site.trim(), thickness, batchId: form.batchId,
      mountedAt, status: "pending", versions: [], restainCount: 0,
    };
    // 若目标批次已有不合格切片，新切片按 R4 直接进入待复核
    if (state.slides.some((s) => s.batchId === slide.batchId && s.status === "unqualified")) {
      slide.status = "review";
    }
    setState({ ...state, slides: [...state.slides, slide] });
    setForm({ ...form, id: "", site: "" });
    setSelectedId(id);
    say("ok", `切片 ${id} 已登记（${STATUS_LABEL[slide.status]}）`);
  };

  const submitBatch = () => {
    const id = batchForm.id.trim();
    if (!id) return say("err", "请填写批次号");
    if (batchById.has(id)) return say("err", `批次 ${id} 已存在`);
    setState({
      ...state,
      batches: [...state.batches, { id, stain: batchForm.stain.trim() || "HE 染色", createdAt: now, released: false }],
    });
    setBatchForm({ id: "", stain: batchForm.stain });
    say("ok", `批次 ${id} 已创建（未放行）`);
  };

  const toggleRelease = (batchId: string) => {
    setState({
      ...state,
      batches: state.batches.map((b) =>
        b.id === batchId
          ? b.released
            ? { ...b, released: false, releasedAt: undefined }
            : { ...b, released: true, releasedAt: now }
          : b
      ),
    });
    say("ok", `批次 ${batchId} 已${batchById.get(batchId)?.released ? "撤回放行" : "放行"}`);
  };

  const openAction = (a: Action) => {
    setAction(a);
    setSelectedId(a.slideId);
    setConclForm({ result: RESULT_OPTIONS[0], note: "", reason: "" });
  };

  const submitConclusion = () => {
    if (!action || !actionSlide) return;
    const blocks = gateBlocks(actionSlide, batchById.get(actionSlide.batchId), now);
    if (blocks.length > 0) return say("err", `门槛未通过：${blocks.join("；")}`);
    const reason = action.type === "interpret" ? "首次判读" : conclForm.reason.trim();
    if (action.type === "review" && !reason) return say("err", "复核必须填写原因");
    setState(addConclusion(state, actionSlide.id, conclForm.result, conclForm.note.trim(), reason, now));
    setAction(null);
    say("ok", `${actionSlide.id} 已生成 v${actionSlide.versions.length + 1}（${reason}），旧版本已保留`);
  };

  const doRestain = (slide: Slide) => {
    const newBatchId = `${slide.batchId}-R${slide.restainCount + 1}`;
    if (!window.confirm(`重染 ${slide.id}：\n· 新建批次 ${newBatchId}（未放行）\n· 冻结现有 ${slide.versions.length} 条结论\n· 封片时间重设为现在\n是否继续？`)) return;
    setState(restain(state, slide.id, now));
    setAction(null);
    say("ok", `${slide.id} 已重染：新批次 ${newBatchId}，原结论已冻结`);
  };

  const doUnqualified = (slide: Slide) => {
    const mates = state.slides.filter((s) => s.batchId === slide.batchId && s.id !== slide.id &&
      (s.status === "pending" || s.status === "interpreted"));
    if (!window.confirm(`标记 ${slide.id} 不合格？\n同批 ${mates.length} 张切片将转入待复核。`)) return;
    setState(markUnqualified(state, slide.id));
    say("ok", `${slide.id} 已标记不合格，同批 ${mates.length} 张转入待复核`);
  };

  const resetDemo = () => {
    if (!window.confirm("清空本地数据并恢复演示数据？")) return;
    localStorage.removeItem(STORAGE_KEY);
    setState(seedState(Date.now()));
    setSelectedId(null);
    setAction(null);
    say("ok", "已恢复演示数据");
  };

  /* ---------- 渲染 ---------- */

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-06 · port 5106</p>
          <h1>切片复核闭环</h1>
          <p className="subtitle">
            登记 → 批次放行 → 判读 → 复核版本链 → 重染冻结，全链路留痕，刷新后状态一致。
          </p>
        </div>
        <div className="stack-card">
          <span>判读门槛（缺一不可）</span>
          <strong>厚度 {THICKNESS_MIN}–{THICKNESS_MAX} μm</strong>
          <strong>封片固化 ≥ {MOUNT_MIN_HOURS}h</strong>
          <strong>染色批次已放行</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, i) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={["status-ok", "status-watch", "status-ok", conflicts.length ? "status-danger" : "status-ok"][i]} />
          </article>
        ))}
      </section>

      {notice && (
        <div className={notice.kind === "ok" ? "notice notice-ok" : "notice notice-err"}>
          {notice.text}
          <button className="notice-close" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <section className="workspace">
        <aside className="panel narrow">
          <h2>登记切片</h2>
          <div className="form-stack">
            <label>
              <span>编号 *</span>
              <input value={form.id} placeholder="如 SP-010" onChange={(e) => setForm({ ...form, id: e.target.value })} />
            </label>
            <label>
              <span>部位 *</span>
              <input value={form.site} placeholder="如 胃黏膜" onChange={(e) => setForm({ ...form, site: e.target.value })} />
            </label>
            <label>
              <span>厚度（μm）*</span>
              <input type="number" step="0.5" min="0" value={form.thickness} onChange={(e) => setForm({ ...form, thickness: e.target.value })} />
            </label>
            <label>
              <span>染色批次 *</span>
              <select value={form.batchId} onChange={(e) => setForm({ ...form, batchId: e.target.value })}>
                <option value="">选择批次</option>
                {state.batches.map((b) => (
                  <option key={b.id} value={b.id}>{b.id}（{b.released ? "已放行" : "未放行"}）</option>
                ))}
              </select>
            </label>
            <label>
              <span>封片时间 *</span>
              <input type="datetime-local" value={form.mountedAt} onChange={(e) => setForm({ ...form, mountedAt: e.target.value })} />
            </label>
            <button className="primary-action" onClick={submitSlide}>登记</button>
          </div>

          <h2>新建批次</h2>
          <div className="form-stack">
            <label>
              <span>批次号 *</span>
              <input value={batchForm.id} placeholder="如 HE-260920" onChange={(e) => setBatchForm({ ...batchForm, id: e.target.value })} />
            </label>
            <label>
              <span>染色方法</span>
              <input value={batchForm.stain} onChange={(e) => setBatchForm({ ...batchForm, stain: e.target.value })} />
            </label>
            <button onClick={submitBatch}>创建批次</button>
          </div>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>切片台账</p>
              <h2>登记信息与判读门槛</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table className="slide-table">
              <thead>
                <tr>
                  <th>编号</th><th>部位</th><th>厚度</th><th>批次</th><th>封片</th>
                  <th>状态</th><th>门槛</th><th>当前结论</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.slides.map((s) => {
                  const blocks = gateBlocks(s, batchById.get(s.batchId), now);
                  const current = s.versions[s.versions.length - 1];
                  return (
                    <tr key={s.id} className={s.id === selectedId ? "row-selected" : ""} onClick={() => setSelectedId(s.id)}>
                      <td><strong>{s.id}</strong>{s.restainCount > 0 && <em className="restain-tag">重染×{s.restainCount}</em>}</td>
                      <td>{s.site}</td>
                      <td className={s.thickness < THICKNESS_MIN || s.thickness > THICKNESS_MAX ? "cell-bad" : ""}>{s.thickness}μm</td>
                      <td>{s.batchId}</td>
                      <td title={fmtTime(s.mountedAt)}>{fmtAgo(s.mountedAt, now)}前</td>
                      <td><span className={`badge b-${s.status}`}>{STATUS_LABEL[s.status]}</span></td>
                      <td>
                        {blocks.length === 0
                          ? <span className="gate-ok">可判读</span>
                          : <span className="gate-block" title={blocks.join("；")}>阻断×{blocks.length}</span>}
                      </td>
                      <td>{current ? `v${current.version} ${current.result}` : "—"}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          {s.status === "pending" && (
                            <button className="mini primary" disabled={blocks.length > 0} title={blocks.join("；")} onClick={() => openAction({ type: "interpret", slideId: s.id })}>判读</button>
                          )}
                          {(s.status === "interpreted" || s.status === "review") && (
                            <button className="mini primary" disabled={blocks.length > 0} title={blocks.join("；")} onClick={() => openAction({ type: "review", slideId: s.id })}>复核</button>
                          )}
                          <button className="mini" onClick={() => doRestain(s)}>重染</button>
                          {s.status !== "unqualified" && <button className="mini danger" onClick={() => doUnqualified(s)}>不合格</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {action && actionSlide && (
            <div className="action-sheet">
              <h3>{action.type === "interpret" ? "判读" : "复核"} · {actionSlide.id}（{actionSlide.site}）</h3>
              <div className="action-grid">
                <label>
                  <span>结论</span>
                  <select value={conclForm.result} onChange={(e) => setConclForm({ ...conclForm, result: e.target.value })}>
                    {RESULT_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <label>
                  <span>描述</span>
                  <input value={conclForm.note} placeholder="镜下所见" onChange={(e) => setConclForm({ ...conclForm, note: e.target.value })} />
                </label>
                {action.type === "review" && (
                  <label>
                    <span>复核原因 *</span>
                    <input value={conclForm.reason} placeholder="如 教研抽查 / 同批不合格复核" onChange={(e) => setConclForm({ ...conclForm, reason: e.target.value })} />
                  </label>
                )}
              </div>
              <p className="action-hint">
                将生成 v{actionSlide.versions.length + 1}，现有 {actionSlide.versions.length} 个版本全部保留。
              </p>
              <div className="row-actions">
                <button className="primary-action" onClick={submitConclusion}>提交 v{actionSlide.versions.length + 1}</button>
                <button onClick={() => setAction(null)}>取消</button>
              </div>
            </div>
          )}
        </section>
      </section>

      {selected && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>版本链 · {selected.id}（{selected.site} · {selected.thickness}μm · {selected.batchId}）</p>
              <h2>结论版本与复核留痕</h2>
            </div>
            <span className={`badge b-${selected.status}`}>{STATUS_LABEL[selected.status]}</span>
          </div>
          {selected.versions.length === 0 ? (
            <p className="empty-hint">尚无结论版本。</p>
          ) : (
            <ol className="timeline">
              {[...selected.versions].reverse().map((ver) => (
                <li key={ver.version} className={ver.frozen ? "ver-frozen" : ""}>
                  <div className="ver-head">
                    <strong>v{ver.version} · {ver.result}</strong>
                    {ver.frozen && <span className="badge b-frozen">已冻结</span>}
                    <span className="ver-meta">{ver.batchId} · {fmtTime(ver.createdAt)}</span>
                  </div>
                  <p>{ver.note || "（无描述）"}</p>
                  <p className="ver-reason">原因：{ver.reason}</p>
                </li>
              ))}
            </ol>
          )}
          {conflicts.some((c) => c.slideId === selected.id) && (
            <p className="empty-hint warn-text">
              该切片存在 {conflicts.filter((c) => c.slideId === selected.id).length} 条冲突，见下方冲突清单。
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>染色批次</p>
            <h2>放行与联动</h2>
          </div>
        </div>
        <div className="batch-grid">
          {state.batches.map((b) => {
            const slides = state.slides.filter((s) => s.batchId === b.id);
            const bad = slides.filter((s) => s.status === "unqualified").length;
            const review = slides.filter((s) => s.status === "review").length;
            return (
              <article className="batch-card" key={b.id}>
                <div className="ver-head">
                  <strong>{b.id}</strong>
                  <span className={`badge ${b.released ? "b-interpreted" : "b-pending"}`}>{b.released ? "已放行" : "未放行"}</span>
                </div>
                <p>{b.stain} · 切片 {slides.length} 张{bad > 0 && ` · 不合格 ${bad}`}{review > 0 && ` · 待复核 ${review}`}</p>
                <p className="ver-meta">创建于 {fmtTime(b.createdAt)}{b.releasedAt ? ` · 放行于 ${fmtTime(b.releasedAt)}` : ""}</p>
                <button className="mini" onClick={() => toggleRelease(b.id)}>{b.released ? "撤回放行" : "放行"}</button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>一致性校验</p>
            <h2>冲突清单（{conflicts.length}）</h2>
          </div>
          <div className="row-actions">
            <button className="mini" onClick={() => setTick((t) => t + 1)}>重新校验</button>
            <button className="mini danger" onClick={resetDemo}>重置演示数据</button>
          </div>
        </div>
        {conflicts.length === 0 ? (
          <p className="empty-hint">校验通过：切片、批次、复核状态与版本链一致。</p>
        ) : (
          <div className="table-wrap">
            <table className="slide-table conflict-table">
              <thead>
                <tr><th>编号</th><th>批次</th><th>原值</th><th>触发规则</th></tr>
              </thead>
              <tbody>
                {conflicts.map((c, i) => (
                  <tr key={`${c.slideId}-${c.rule}-${i}`} onClick={() => setSelectedId(c.slideId)}>
                    <td><strong>{c.slideId}</strong></td>
                    <td>{c.batchId}</td>
                    <td className="cell-bad">{c.value}</td>
                    <td>{c.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
