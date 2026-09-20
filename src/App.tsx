import { useEffect, useState } from "react";
import "./styles.css";
import {
  DomainState,
  RULE_TEXT,
  RuleCode,
  SEED_NOW,
  seedState,
} from "./review/domain";
import {
  DomainError,
  computeMetrics,
  createBatch,
  interpretSlide,
  loadNow,
  loadState,
  registerSlide,
  rejectSlide,
  releaseBatch,
  restainSlide,
  reviewSlide,
  saveNow,
  saveState,
} from "./review/store";
import {
  InterpretInput,
  RejectInput,
  RestainInput,
  ReviewInput,
  SlideTable,
} from "./review/SlideTable";
import { BatchPanel, RegisterForm, RegisterInput } from "./review/panels";
import { ConflictList, VersionChain } from "./review/VersionChain";
import { fmtTime } from "./review/ui";

const project = {
  id: "hxwl-06",
  port: 5106,
  title: "显微镜玻片观察 · 切片复核闭环",
  subtitle:
    "切片登记（编号 / 部位 / 厚度 / 染色批次 / 封片时间）→ 判读门槛校验 → 复核版本链 → 不合格整批牵连，全程可追溯。",
};

const RULE_CODES: RuleCode[] = ["R1", "R2", "R3", "R4", "R5", "R6"];

interface Toast {
  kind: "ok" | "err";
  text: string;
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "watch" | "danger";
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={`status-${tone}`} />
    </article>
  );
}

function App() {
  const [state, setState] = useState<DomainState>(() => loadState());
  const [nowIso, setNowIso] = useState<string>(() => loadNow());
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const commit = (next: DomainState) => {
    saveState(next);
    setState(next);
  };

  /** 运行动作：成功则提交状态并提示，领域错误以冲突提示展示。 */
  const run = (action: () => { next: DomainState; message: string }) => {
    try {
      const { next, message } = action();
      commit(next);
      setToast({ kind: "ok", text: message });
    } catch (e) {
      const text =
        e instanceof DomainError || e instanceof Error ? e.message : String(e);
      setToast({ kind: "err", text });
    }
  };

  const metrics = computeMetrics(state);

  const advanceClock = () => {
    const next = new Date(Date.parse(nowIso) + 6 * 3_600_000).toISOString();
    saveNow(next);
    setNowIso(next);
    setToast({ kind: "ok", text: `演示时钟已推进 6 小时（当前 ${fmtTime(next)}）` });
  };

  const resetDemo = () => {
    const fresh = seedState();
    saveState(fresh);
    saveNow(SEED_NOW);
    setState(fresh);
    setNowIso(SEED_NOW);
    setSelectedSlideId(null);
    setToast({ kind: "ok", text: "已重置为初始演示数据" });
  };

  const onRegister = (input: RegisterInput) =>
    run(() => {
      const { state: next, slideId } = registerSlide(state, input, nowIso);
      return { next, message: `切片 ${slideId} 登记成功` };
    });

  const onInterpret = (slideId: string, input: InterpretInput) =>
    run(() => ({
      next: interpretSlide(state, slideId, input.conclusion, nowIso),
      message: `切片 ${slideId} 判读完成，生成 v1`,
    }));

  const onReview = (slideId: string, input: ReviewInput) =>
    run(() => ({
      next: reviewSlide(state, slideId, input, nowIso),
      message: `切片 ${slideId} 复核完成，已生成带原因的新版本`,
    }));

  const onReject = (slideId: string, input: RejectInput) =>
    run(() => ({
      next: rejectSlide(state, slideId, input, nowIso),
      message: `切片 ${slideId} 判定不合格：批次隔离，同批其余切片转待复核`,
    }));

  const onRestain = (slideId: string, input: RestainInput) =>
    run(() => {
      const { state: next, slideId: newId, batchId } = restainSlide(state, slideId, input, nowIso);
      return {
        next,
        message: `已新建批次 ${batchId} 并重染，新切片 ${newId} 登记，原结论冻结`,
      };
    });

  const onRelease = (batchId: string) =>
    run(() => ({
      next: releaseBatch(state, batchId, nowIso),
      message: `批次 ${batchId} 已放行`,
    }));

  const onCreateBatch = (input: { stain: string; note: string }) =>
    run(() => {
      const { state: next, batchId } = createBatch(state, input, nowIso);
      return { next, message: `批次 ${batchId} 已建立，待质控放行` };
    });

  return (
    <main className="app-shell">
      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}

      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>演示时钟（判读门槛以此为准）</span>
          <strong>{fmtTime(nowIso)}</strong>
          <div className="clock-actions">
            <button onClick={advanceClock}>时间 +6h</button>
            <button onClick={resetDemo}>重置演示</button>
          </div>
        </div>
      </section>

      <section className="metrics-grid six">
        <MetricCard label="切片总数" value={metrics.slideCount} tone="ok" />
        <MetricCard label="染色批次" value={metrics.batchCount} tone="ok" />
        <MetricCard label="待复核" value={metrics.pendingReviewCount} tone="watch" />
        <MetricCard label="冻结（重染中）" value={metrics.frozenCount} tone="watch" />
        <MetricCard label="结论版本" value={metrics.versionCount} tone="ok" />
        <MetricCard label="冲突记录" value={metrics.conflictCount} tone="danger" />
      </section>

      <section className="panel rules-panel">
        <h2>闭环规则</h2>
        <div className="rules-grid">
          {RULE_CODES.map((code) => (
            <div key={code} className="rule-card">
              <strong>{code}</strong>
              <span>{RULE_TEXT[code]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>切片登记</h2>
          <RegisterForm state={state} nowIso={nowIso} onRegister={onRegister} />
          <h2>染色批次</h2>
          <BatchPanel state={state} onRelease={onRelease} onCreateBatch={onCreateBatch} />
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>登记 · 判读 · 复核 · 重染</p>
              <h2>切片登记表</h2>
            </div>
          </div>
          <SlideTable
            state={state}
            nowIso={nowIso}
            selectedSlideId={selectedSlideId}
            onSelectSlide={setSelectedSlideId}
            onInterpret={onInterpret}
            onReview={onReview}
            onReject={onReject}
            onRestain={onRestain}
          />
        </section>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>判读历史，旧版本全部保留</p>
            <h2>复核版本链</h2>
          </div>
        </div>
        <VersionChain state={state} slideId={selectedSlideId} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>编号 · 批次 · 原值 · 触发规则</p>
            <h2>冲突记录</h2>
          </div>
        </div>
        <ConflictList state={state} />
      </section>
    </main>
  );
}

export default App;
