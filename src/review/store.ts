// ReviewStore：所有状态变更的唯一入口。
// 每次操作后把整棵状态树写入 localStorage，刷新后完整恢复，
// 保证切片、批次、复核状态与版本链一致。

import {
  ConclusionVersion,
  Conflict,
  DomainState,
  MIN_COVER_HOURS,
  OrganSite,
  RejectReason,
  RejectRecord,
  RULE_TEXT,
  RuleCode,
  SEED_NOW,
  Slide,
  StainBatch,
  THICKNESS_MAX_UM,
  THICKNESS_MIN_UM,
  batchOf,
  batchStatusLabel,
  coverslipHours,
  currentVersionOf,
  interpretBlockers,
  isInterpretableStatus,
  seedState,
  slideOf,
  slideStatusLabel,
  versionsOf,
} from "./domain";

export const STORAGE_KEY = "hxwl-06-review-loop-v1";
export const CLOCK_KEY = "hxwl-06-review-clock-v1";

export class DomainError extends Error {}

// ---------- 持久化 ----------

export function loadState(): DomainState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DomainState;
      if (parsed && Array.isArray(parsed.slides) && Array.isArray(parsed.batches)) {
        return parsed;
      }
    }
  } catch {
    // 存储损坏时回退到种子数据
  }
  return seedState();
}

export function saveState(state: DomainState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadNow(): string {
  return localStorage.getItem(CLOCK_KEY) ?? SEED_NOW;
}

export function saveNow(nowIso: string): void {
  localStorage.setItem(CLOCK_KEY, nowIso);
}

// ---------- 工具 ----------

function clone(state: DomainState): DomainState {
  return JSON.parse(JSON.stringify(state)) as DomainState;
}

function nextNumber(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (id.startsWith(prefix)) {
      const n = Number(id.slice(prefix.length));
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

function nextSlideId(state: DomainState): string {
  return `S-${nextNumber(state.slides.map((s) => s.id), "S-")}`;
}

function nextBatchId(state: DomainState): string {
  return `B-${nextNumber(state.batches.map((b) => b.id), "B-")}`;
}

function nextRejectId(state: DomainState): string {
  return `RJ-${String(nextNumber(state.rejects.map((r) => r.id), "RJ-")).padStart(3, "0")}`;
}

function nextConflictId(state: DomainState): string {
  return `CF-${String(nextNumber(state.conflicts.map((c) => c.id), "CF-")).padStart(3, "0")}`;
}

function pushConflict(
  state: DomainState,
  nowIso: string,
  input: Omit<Conflict, "id" | "createdAt">
): void {
  state.conflicts.push({ ...input, id: nextConflictId(state), createdAt: nowIso });
}

function assertThickness(thicknessUm: number): void {
  if (!Number.isFinite(thicknessUm)) {
    throw new DomainError("厚度必须是数字");
  }
  if (thicknessUm < THICKNESS_MIN_UM || thicknessUm > THICKNESS_MAX_UM) {
    throw new DomainError(
      `登记失败（R1 ${RULE_TEXT.R1}）：厚度 ${thicknessUm} μm 不在 ${THICKNESS_MIN_UM}–${THICKNESS_MAX_UM} μm 区间`
    );
  }
}

// ---------- 动作 ----------

export function registerSlide(
  prev: DomainState,
  input: {
    organ: OrganSite;
    thicknessUm: number;
    batchId: string;
    coverslippedAt: string;
  },
  nowIso: string
): { state: DomainState; slideId: string } {
  batchOf(prev, input.batchId); // 批次必须存在
  assertThickness(input.thicknessUm);
  if (!input.coverslippedAt || Number.isNaN(Date.parse(input.coverslippedAt))) {
    throw new DomainError("请填写有效的封片时间");
  }

  const state = clone(prev);
  const slide: Slide = {
    id: nextSlideId(state),
    organ: input.organ,
    thicknessUm: input.thicknessUm,
    batchId: input.batchId,
    coverslippedAt: new Date(input.coverslippedAt).toISOString(),
    status: "registered",
    restainOf: null,
    createdAt: nowIso,
  };
  state.slides.push(slide);
  return { state, slideId: slide.id };
}

export function createBatch(
  prev: DomainState,
  input: { stain: string; note: string },
  nowIso: string
): { state: DomainState; batchId: string } {
  if (!input.stain.trim()) throw new DomainError("请填写染色方法");
  const state = clone(prev);
  const batch: StainBatch = {
    id: nextBatchId(state),
    stain: input.stain.trim(),
    preparedAt: nowIso,
    status: "pending_release",
    releasedAt: null,
    supersedes: null,
    note: input.note.trim() || "新配批次，待质控放行",
  };
  state.batches.push(batch);
  return { state, batchId: batch.id };
}

export function releaseBatch(
  prev: DomainState,
  batchId: string,
  nowIso: string
): DomainState {
  const state = clone(prev);
  const batch = batchOf(state, batchId);
  if (batch.status === "released") {
    throw new DomainError(`批次 ${batchId} 已是放行状态`);
  }
  if (batch.status === "quarantined") {
    throw new DomainError(`批次 ${batchId} 已隔离，须重新配制新批次，不能直接放行`);
  }
  batch.status = "released";
  batch.releasedAt = nowIso;
  return state;
}

export function interpretSlide(
  prev: DomainState,
  slideId: string,
  conclusion: string,
  nowIso: string
): DomainState {
  if (!conclusion.trim()) throw new DomainError("请填写判读结论");

  const slide = slideOf(prev, slideId);
  if (!isInterpretableStatus(slide)) {
    throw new DomainError(
      `切片 ${slideId} 当前状态为「${slideStatusLabel(slide.status)}」，不能判读`
    );
  }
  const blockers = interpretBlockers(prev, slideId, nowIso);
  if (blockers.length > 0) {
    const first = blockers[0];
    throw new DomainError(
      `判读被拦截（${first.rule} ${RULE_TEXT[first.rule]}）：${first.detail}`
    );
  }

  const state = clone(prev);
  const target = slideOf(state, slideId);
  const version: ConclusionVersion = {
    id: `V-${slideId}-1`,
    slideId,
    batchId: target.batchId,
    versionNo: 1,
    kind: "initial",
    conclusion: conclusion.trim(),
    reason: null,
    status: "current",
    createdAt: nowIso,
  };
  state.versions.push(version);
  target.status = "interpreted";
  return state;
}

export function reviewSlide(
  prev: DomainState,
  slideId: string,
  input: { conclusion: string; reason: string },
  nowIso: string
): DomainState {
  if (!input.reason.trim()) {
    throw new DomainError(`复核必须填写原因（${RULE_TEXT.R6}）`);
  }
  if (!input.conclusion.trim()) throw new DomainError("请填写复核结论");

  const slide = slideOf(prev, slideId);
  const current = currentVersionOf(prev, slideId);
  if (!current) {
    throw new DomainError(`切片 ${slideId} 尚无判读结论，请先完成判读`);
  }
  if (slide.status === "frozen") {
    throw new DomainError(`切片 ${slideId} 已冻结（重染中），不能复核`);
  }
  const blockers = interpretBlockers(prev, slideId, nowIso);
  if (blockers.length > 0) {
    const first = blockers[0];
    throw new DomainError(
      `复核被拦截（${first.rule} ${RULE_TEXT[first.rule]}）：${first.detail}`
    );
  }

  const state = clone(prev);
  const versions = versionsOf(state, slideId);
  for (const v of versions) {
    if (v.status === "current") v.status = "superseded";
  }
  const nextNo = versions.length + 1;
  const version: ConclusionVersion = {
    id: `V-${slideId}-${nextNo}`,
    slideId,
    batchId: slideOf(state, slideId).batchId,
    versionNo: nextNo,
    kind: "review",
    conclusion: input.conclusion.trim(),
    reason: input.reason.trim(),
    status: "current",
    createdAt: nowIso,
  };
  state.versions.push(version);
  slideOf(state, slideId).status = "interpreted";
  return state;
}

export function rejectSlide(
  prev: DomainState,
  slideId: string,
  input: { reason: RejectReason; note: string },
  nowIso: string
): DomainState {
  slideOf(prev, slideId); // 切片必须存在

  const state = clone(prev);
  const target = slideOf(state, slideId);

  // 1) 登记不合格记录
  const reject: RejectRecord = {
    id: nextRejectId(state),
    slideId,
    batchId: target.batchId,
    reason: input.reason,
    note: input.note.trim(),
    createdAt: nowIso,
  };
  state.rejects.push(reject);

  // 2) 批次隔离
  const batchTarget = batchOf(state, target.batchId);
  if (batchTarget.status !== "quarantined") {
    pushConflict(state, nowIso, {
      slideId,
      batchId: batchTarget.id,
      rule: "R3",
      field: "批次状态",
      oldValue: batchStatusLabel(batchTarget.status),
      newValue: batchStatusLabel("quarantined"),
      detail: `切片 ${slideId} 判定不合格（${input.reason}），批次整批隔离`,
    });
    batchTarget.status = "quarantined";
    batchTarget.releasedAt = null;
  }

  // 3) 该切片冻结，当前结论冻结
  if (target.status !== "frozen") {
    pushConflict(state, nowIso, {
      slideId,
      batchId: batchTarget.id,
      rule: "R5",
      field: "切片状态",
      oldValue: slideStatusLabel(target.status),
      newValue: slideStatusLabel("frozen"),
      detail: "不合格切片进入冻结，等待重染",
    });
    target.status = "frozen";
  }
  for (const v of versionsOf(state, slideId)) {
    if (v.status === "current") v.status = "frozen";
  }

  // 4) 同批其余切片转入待复核（规则 R4）
  for (const other of state.slides) {
    if (other.batchId !== batchTarget.id || other.id === slideId) continue;
    if (other.status === "registered" || other.status === "interpreted") {
      pushConflict(state, nowIso, {
        slideId: other.id,
        batchId: batchTarget.id,
        rule: "R4",
        field: "切片状态",
        oldValue: slideStatusLabel(other.status),
        newValue: slideStatusLabel("pending_review"),
        detail: `同批切片 ${slideId} 不合格，整批复核`,
      });
      other.status = "pending_review";
    }
  }

  return state;
}

export function restainSlide(
  prev: DomainState,
  slideId: string,
  input: { stain: string; thicknessUm: number; coverslippedAt: string },
  nowIso: string
): { state: DomainState; slideId: string; batchId: string } {
  const source = slideOf(prev, slideId);
  if (source.status !== "frozen") {
    throw new DomainError(
      `仅冻结状态的切片可以重染，${slideId} 当前为「${slideStatusLabel(source.status)}」`
    );
  }
  assertThickness(input.thicknessUm);
  if (!input.stain.trim()) throw new DomainError("请填写重染的染色方法");
  if (!input.coverslippedAt || Number.isNaN(Date.parse(input.coverslippedAt))) {
    throw new DomainError("请填写有效的封片时间");
  }

  const state = clone(prev);

  // 1) 新建批次（规则 R5），新批次默认待放行
  const batch: StainBatch = {
    id: nextBatchId(state),
    stain: input.stain.trim(),
    preparedAt: nowIso,
    status: "pending_release",
    releasedAt: null,
    supersedes: source.batchId,
    note: `重染批，替换批次 ${source.batchId}`,
  };
  state.batches.push(batch);

  // 2) 原切片结论冻结（幂等，冻结当前版本）
  const sourceTarget = slideOf(state, slideId);
  for (const v of versionsOf(state, slideId)) {
    if (v.status === "current") v.status = "frozen";
  }
  sourceTarget.status = "frozen";

  // 3) 新建切片，挂到新批次
  const slide: Slide = {
    id: nextSlideId(state),
    organ: sourceTarget.organ,
    thicknessUm: input.thicknessUm,
    batchId: batch.id,
    coverslippedAt: new Date(input.coverslippedAt).toISOString(),
    status: "registered",
    restainOf: slideId,
    createdAt: nowIso,
  };
  state.slides.push(slide);

  pushConflict(state, nowIso, {
    slideId,
    batchId: batch.id,
    rule: "R5",
    field: "染色批次",
    oldValue: sourceTarget.batchId,
    newValue: batch.id,
    detail: `重染新建批次 ${batch.id}，原结论冻结，新切片 ${slide.id} 重新登记`,
  });

  return { state, slideId: slide.id, batchId: batch.id };
}

/** 登记时同编号冲突演示：返回冲突记录所需的信息。 */
export function describeRegistrationConflict(
  prev: DomainState,
  slideId: string,
  input: { organ: OrganSite; thicknessUm: number; batchId: string; coverslippedAt: string }
): Omit<Conflict, "id" | "createdAt"> | null {
  const existing = prev.slides.find((s) => s.id === slideId);
  if (!existing) return null;
  const changed: string[] = [];
  if (existing.organ !== input.organ) changed.push(`部位 ${existing.organ}→${input.organ}`);
  if (existing.thicknessUm !== input.thicknessUm)
    changed.push(`厚度 ${existing.thicknessUm}→${input.thicknessUm} μm`);
  if (existing.batchId !== input.batchId)
    changed.push(`批次 ${existing.batchId}→${input.batchId}`);
  if (Date.parse(existing.coverslippedAt) !== Date.parse(input.coverslippedAt))
    changed.push("封片时间不一致");
  return {
    slideId,
    batchId: existing.batchId,
    rule: "R1",
    field: "切片登记",
    oldValue: `编号 ${slideId} 已登记（${existing.organ} · ${existing.thicknessUm} μm · ${existing.batchId}）`,
    newValue: changed.length > 0 ? changed.join("；") : "重复登记，内容一致",
    detail: "切片编号唯一，重复登记须走重染或复核流程",
  };
}

export function logConflict(
  prev: DomainState,
  input: Omit<Conflict, "id" | "createdAt">,
  nowIso: string
): DomainState {
  const state = clone(prev);
  pushConflict(state, nowIso, input);
  return state;
}

// ---------- 汇总指标 ----------

export interface Metrics {
  slideCount: number;
  batchCount: number;
  pendingReviewCount: number;
  versionCount: number;
  frozenCount: number;
  conflictCount: number;
}

export function computeMetrics(state: DomainState): Metrics {
  return {
    slideCount: state.slides.length,
    batchCount: state.batches.length,
    pendingReviewCount: state.slides.filter((s) => s.status === "pending_review").length,
    versionCount: state.versions.length,
    frozenCount: state.slides.filter((s) => s.status === "frozen").length,
    conflictCount: state.conflicts.length,
  };
}

export { RULE_TEXT, MIN_COVER_HOURS };
export type { RuleCode };
