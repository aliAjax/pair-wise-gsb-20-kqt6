// 切片登记表：编号、部位、厚度、染色批次、封片时间一览，
// 并在行内提供判读 / 复核 / 不合格 / 重染 / 版本链操作。

import { useState } from "react";
import {
  DomainState,
  OrganSite,
  RejectReason,
  Slide,
  batchOf,
  coverslipHours,
  currentVersionOf,
  interpretBlockers,
} from "./domain";
import { BatchStatusBadge, RuleTag, SlideStatusBadge, fmtTime, toLocalInputValue } from "./ui";

export interface InterpretInput {
  conclusion: string;
}

export interface ReviewInput {
  conclusion: string;
  reason: string;
}

export interface RejectInput {
  reason: RejectReason;
  note: string;
}

export interface RestainInput {
  stain: string;
  thicknessUm: number;
  coverslippedAt: string;
}

interface SlideTableProps {
  state: DomainState;
  nowIso: string;
  selectedSlideId: string | null;
  onSelectSlide: (slideId: string) => void;
  onInterpret: (slideId: string, input: InterpretInput) => void;
  onReview: (slideId: string, input: ReviewInput) => void;
  onReject: (slideId: string, input: RejectInput) => void;
  onRestain: (slideId: string, input: RestainInput) => void;
}

type FormKind = "interpret" | "review" | "reject" | "restain";

const REJECT_REASONS: RejectReason[] = [
  "厚度超标",
  "染色不均",
  "组织折叠",
  "封片气泡",
  "背景污染",
];

export function SlideTable(props: SlideTableProps) {
  const { state, nowIso } = props;
  const [openForm, setOpenForm] = useState<{ slideId: string; kind: FormKind } | null>(null);

  const toggleForm = (slideId: string, kind: FormKind) => {
    setOpenForm((prev) =>
      prev && prev.slideId === slideId && prev.kind === kind ? null : { slideId, kind }
    );
  };

  const closeForm = () => setOpenForm(null);

  return (
    <div className="table-wrap">
      <table className="slide-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>部位</th>
            <th>厚度(μm)</th>
            <th>染色批次</th>
            <th>封片时间</th>
            <th>状态</th>
            <th>判读门槛</th>
            <th>当前结论</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {state.slides.map((slide) => (
            <SlideRows
              key={slide.id}
              {...props}
              slide={slide}
              formOpen={openForm?.slideId === slide.id ? openForm.kind : null}
              onToggleForm={toggleForm}
              onCloseForm={closeForm}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SlideRowsProps extends SlideTableProps {
  slide: Slide;
  formOpen: FormKind | null;
  onToggleForm: (slideId: string, kind: FormKind) => void;
  onCloseForm: () => void;
}

function SlideRows(props: SlideRowsProps) {
  const { state, nowIso, slide, formOpen, onToggleForm, onCloseForm } = props;
  const batch = batchOf(state, slide.batchId);
  const blockers = interpretBlockers(state, slide.id, nowIso);
  const current = currentVersionOf(state, slide.id);
  const hours = coverslipHours(slide, nowIso);
  const frozen = slide.status === "frozen";
  const canInterpret = slide.status === "registered" && !current && blockers.length === 0;
  const canReview = current !== null && !frozen && blockers.length === 0;

  return (
    <>
      <tr className={props.selectedSlideId === slide.id ? "row-selected" : undefined}>
        <td>
          <strong>{slide.id}</strong>
          {slide.restainOf && <span className="sub-tag">重染自 {slide.restainOf}</span>}
        </td>
        <td>{slide.organ}</td>
        <td>{slide.thicknessUm}</td>
        <td>
          <div className="cell-stack">
            <span>{batch.id}</span>
            <BatchStatusBadge status={batch.status} />
          </div>
        </td>
        <td>
          <div className="cell-stack">
            <span>{fmtTime(slide.coverslippedAt)}</span>
            <span className="muted-text">{hours} h</span>
          </div>
        </td>
        <td>
          <SlideStatusBadge status={slide.status} />
        </td>
        <td className="blocker-cell">
          {frozen ? (
            <span className="muted-text">冻结中</span>
          ) : blockers.length === 0 ? (
            <span className="ok-text">可判读</span>
          ) : (
            blockers.map((b) => <RuleTag key={b.rule} rule={b.rule} />)
          )}
        </td>
        <td className="conclusion-cell">
          {current ? (
            <span title={current.conclusion}>
              v{current.versionNo} · {current.conclusion}
            </span>
          ) : (
            <span className="muted-text">—</span>
          )}
        </td>
        <td>
          <div className="row-actions">
            <button
              disabled={!canInterpret}
              onClick={() => onToggleForm(slide.id, "interpret")}
            >
              判读
            </button>
            <button
              disabled={!canReview}
              onClick={() => onToggleForm(slide.id, "review")}
            >
              复核
            </button>
            <button
              className="danger"
              disabled={frozen}
              onClick={() => onToggleForm(slide.id, "reject")}
            >
              不合格
            </button>
            <button
              disabled={!frozen}
              onClick={() => onToggleForm(slide.id, "restain")}
            >
              重染
            </button>
            <button onClick={() => props.onSelectSlide(slide.id)}>版本链</button>
          </div>
        </td>
      </tr>
      {formOpen && (
        <tr className="form-row">
          <td colSpan={9}>
            {formOpen === "interpret" && (
              <InterpretForm
                slideId={slide.id}
                onSubmit={(input) => {
                  props.onInterpret(slide.id, input);
                  onCloseForm();
                }}
                onCancel={onCloseForm}
              />
            )}
            {formOpen === "review" && (
              <ReviewForm
                slideId={slide.id}
                currentConclusion={current?.conclusion ?? ""}
                onSubmit={(input) => {
                  props.onReview(slide.id, input);
                  onCloseForm();
                }}
                onCancel={onCloseForm}
              />
            )}
            {formOpen === "reject" && (
              <RejectForm
                slideId={slide.id}
                onSubmit={(input) => {
                  props.onReject(slide.id, input);
                  onCloseForm();
                }}
                onCancel={onCloseForm}
              />
            )}
            {formOpen === "restain" && (
              <RestainForm
                slideId={slide.id}
                nowIso={nowIso}
                defaultThickness={slide.thicknessUm}
                defaultStain={batch.stain}
                onSubmit={(input) => {
                  props.onRestain(slide.id, input);
                  onCloseForm();
                }}
                onCancel={onCloseForm}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function InterpretForm({
  slideId,
  onSubmit,
  onCancel,
}: {
  slideId: string;
  onSubmit: (input: InterpretInput) => void;
  onCancel: () => void;
}) {
  const [conclusion, setConclusion] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ conclusion });
      }}
    >
      <strong>判读 {slideId}</strong>
      <textarea
        required
        rows={2}
        placeholder="填写镜下判读结论"
        value={conclusion}
        onChange={(e) => setConclusion(e.target.value)}
      />
      <div className="form-actions">
        <button type="submit" className="primary-action">
          提交判读（生成 v1）
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

function ReviewForm({
  slideId,
  currentConclusion,
  onSubmit,
  onCancel,
}: {
  slideId: string;
  currentConclusion: string;
  onSubmit: (input: ReviewInput) => void;
  onCancel: () => void;
}) {
  const [conclusion, setConclusion] = useState(currentConclusion);
  const [reason, setReason] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ conclusion, reason });
      }}
    >
      <strong>复核 {slideId}（生成新版本，旧版本保留）</strong>
      <textarea
        required
        rows={2}
        placeholder="复核结论"
        value={conclusion}
        onChange={(e) => setConclusion(e.target.value)}
      />
      <input
        required
        placeholder="复核原因（必填，如：教学复评、初判存疑）"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="form-actions">
        <button type="submit" className="primary-action">
          提交复核新版本
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

function RejectForm({
  slideId,
  onSubmit,
  onCancel,
}: {
  slideId: string;
  onSubmit: (input: RejectInput) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<RejectReason>(REJECT_REASONS[0]);
  const [note, setNote] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ reason, note });
      }}
    >
      <strong>判定 {slideId} 不合格（批次将隔离，同批其余切片转待复核）</strong>
      <div className="form-line">
        <label>
          <span>不合格原因</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as RejectReason)}
          >
            {REJECT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <input
          placeholder="补充说明（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="danger-action">
          确认不合格
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

function RestainForm({
  slideId,
  nowIso,
  defaultThickness,
  defaultStain,
  onSubmit,
  onCancel,
}: {
  slideId: string;
  nowIso: string;
  defaultThickness: number;
  defaultStain: string;
  onSubmit: (input: RestainInput) => void;
  onCancel: () => void;
}) {
  const [stain, setStain] = useState(defaultStain);
  const [thickness, setThickness] = useState(String(defaultThickness));
  const [coverslippedAt, setCoverslippedAt] = useState(toLocalInputValue(nowIso));
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ stain, thicknessUm: Number(thickness), coverslippedAt });
      }}
    >
      <strong>重染 {slideId}（自动新建批次并冻结原结论）</strong>
      <div className="form-line">
        <label>
          <span>染色方法</span>
          <input
            required
            value={stain}
            onChange={(e) => setStain(e.target.value)}
          />
        </label>
        <label>
          <span>新厚度(μm)</span>
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
          <span>新封片时间</span>
          <input
            required
            type="datetime-local"
            value={coverslippedAt}
            onChange={(e) => setCoverslippedAt(e.target.value)}
          />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="primary-action">
          新建批次并重染
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

export const ORGAN_SITES: OrganSite[] = ["肝", "肾", "肺", "胃", "皮肤", "心肌"];
