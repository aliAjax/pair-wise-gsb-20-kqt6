// 切片复核闭环的领域核心：规则常量、类型、纯函数与种子数据。
// 所有会改变状态的操作都通过 ReviewStore 走这里，保证刷新后状态可完整重建。

export const THICKNESS_MIN_UM = 2;
export const THICKNESS_MAX_UM = 8;
export const MIN_COVER_HOURS = 24;

export const RULE_TEXT = {
  R1: `切片厚度须介于 ${THICKNESS_MIN_UM}–${THICKNESS_MAX_UM} μm`,
  R2: `封片须满 ${MIN_COVER_HOURS} 小时方可判读`,
  R3: "染色批次须为已放行状态",
  R4: "同批出现不合格切片，其余切片转入待复核",
  R5: "重染须新建染色批次，原判读结论即时冻结",
  R6: "复核只能生成带原因的新版本，旧版本保留",
} as const;

export type RuleCode = keyof typeof RULE_TEXT;

// ---------- 枚举 ----------

export type OrganSite = "肝" | "肾" | "肺" | "胃" | "皮肤" | "心肌";

export type BatchStatus = "pending_release" | "released" | "quarantined";

export type SlideStatus =
  | "registered" // 已登记，尚未判读
  | "interpreted" // 已有当前判读结论
  | "frozen" // 重染中，原结论冻结
  | "pending_review"; // 同批不合格牵连，待复核

export type VersionStatus = "current" | "superseded" | "frozen";

export type VersionKind = "initial" | "review";

export type RejectReason =
  | "厚度超标"
  | "染色不均"
  | "组织折叠"
  | "封片气泡"
  | "背景污染";

// ---------- 实体 ----------

export interface StainBatch {
  id: string;
  stain: string;
  preparedAt: string; // ISO
  status: BatchStatus;
  releasedAt: string | null;
  supersedes: string | null; // 重染时指向被替换的旧批次
  note: string;
}

export interface Slide {
  id: string;
  organ: OrganSite;
  thicknessUm: number;
  batchId: string;
  coverslippedAt: string; // ISO 封片时间
  status: SlideStatus;
  restainOf: string | null; // 重染产生的新切片指向原切片
  createdAt: string;
}

export interface ConclusionVersion {
  id: string;
  slideId: string;
  batchId: string; // 出具该结论时切片所在批次
  versionNo: number;
  kind: VersionKind;
  conclusion: string;
  reason: string | null; // 复核版本必填
  status: VersionStatus;
  createdAt: string;
}

export interface RejectRecord {
  id: string;
  slideId: string;
  batchId: string;
  reason: RejectReason;
  note: string;
  createdAt: string;
}

export interface Conflict {
  id: string;
  slideId: string;
  batchId: string;
  rule: RuleCode;
  field: string;
  oldValue: string;
  newValue: string;
  detail: string;
  createdAt: string;
}

export interface DomainState {
  slides: Slide[];
  batches: StainBatch[];
  versions: ConclusionVersion[];
  rejects: RejectRecord[];
  conflicts: Conflict[];
}

// ---------- 派生查询 ----------

export function batchOf(state: DomainState, batchId: string): StainBatch {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) throw new Error(`批次不存在：${batchId}`);
  return batch;
}

export function slideOf(state: DomainState, slideId: string): Slide {
  const slide = state.slides.find((s) => s.id === slideId);
  if (!slide) throw new Error(`切片不存在：${slideId}`);
  return slide;
}

export function versionsOf(state: DomainState, slideId: string): ConclusionVersion[] {
  return state.versions
    .filter((v) => v.slideId === slideId)
    .sort((a, b) => a.versionNo - b.versionNo);
}

export function currentVersionOf(
  state: DomainState,
  slideId: string
): ConclusionVersion | null {
  const versions = versionsOf(state, slideId);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

export function coverslipHours(slide: Slide, nowIso: string): number {
  const ms = Date.parse(nowIso) - Date.parse(slide.coverslippedAt);
  return Math.floor((ms / 3_600_000) * 10) / 10;
}

/** 判读门槛：返回命中的规则列表，空数组表示可以判读。 */
export function interpretBlockers(
  state: DomainState,
  slideId: string,
  nowIso: string
): { rule: RuleCode; detail: string }[] {
  const slide = slideOf(state, slideId);
  const batch = batchOf(state, slide.batchId);
  const blockers: { rule: RuleCode; detail: string }[] = [];

  if (slide.thicknessUm < THICKNESS_MIN_UM || slide.thicknessUm > THICKNESS_MAX_UM) {
    blockers.push({
      rule: "R1",
      detail: `厚度 ${slide.thicknessUm} μm，不在 ${THICKNESS_MIN_UM}–${THICKNESS_MAX_UM} μm 区间`,
    });
  }
  const hours = coverslipHours(slide, nowIso);
  if (hours < MIN_COVER_HOURS) {
    blockers.push({
      rule: "R2",
      detail: `封片仅 ${hours} 小时，未满 ${MIN_COVER_HOURS} 小时`,
    });
  }
  if (batch.status !== "released") {
    blockers.push({
      rule: "R3",
      detail: `批次 ${batch.id} 当前为「${batchStatusLabel(batch.status)}」，未放行`,
    });
  }
  return blockers;
}

/** 该切片当前是否处于可判读/可复核的业务状态。 */
export function isInterpretableStatus(slide: Slide): boolean {
  return slide.status === "registered" || slide.status === "interpreted";
}

// ---------- 标签 ----------

export function batchStatusLabel(status: BatchStatus): string {
  switch (status) {
    case "pending_release":
      return "待放行";
    case "released":
      return "已放行";
    case "quarantined":
      return "已隔离";
  }
}

export function slideStatusLabel(status: SlideStatus): string {
  switch (status) {
    case "registered":
      return "已登记";
    case "interpreted":
      return "已判读";
    case "frozen":
      return "冻结（重染中）";
    case "pending_review":
      return "待复核";
  }
}

export function versionStatusLabel(status: VersionStatus): string {
  switch (status) {
    case "current":
      return "当前版本";
    case "superseded":
      return "已被取代";
    case "frozen":
      return "已冻结";
  }
}

// ---------- 种子数据 ----------

export const SEED_NOW = "2026-09-20T09:00:00+08:00";

export function seedState(): DomainState {
  const batches: StainBatch[] = [
    {
      id: "B-2609",
      stain: "HE 染色",
      preparedAt: "2026-09-12T08:30:00+08:00",
      status: "released",
      releasedAt: "2026-09-12T16:00:00+08:00",
      supersedes: null,
      note: "常规教学批，质控通过",
    },
    {
      id: "B-2610",
      stain: "PAS 染色",
      preparedAt: "2026-09-14T09:00:00+08:00",
      status: "pending_release",
      releasedAt: null,
      supersedes: null,
      note: "等待质控签字放行",
    },
    {
      id: "B-2611",
      stain: "Masson 三色",
      preparedAt: "2026-09-15T10:00:00+08:00",
      status: "released",
      releasedAt: "2026-09-15T17:30:00+08:00",
      supersedes: null,
      note: "胶原纤维显示批",
    },
  ];

  const slides: Slide[] = [
    {
      id: "S-260901",
      organ: "肝",
      thicknessUm: 5,
      batchId: "B-2609",
      coverslippedAt: "2026-09-17T09:00:00+08:00",
      status: "interpreted",
      restainOf: null,
      createdAt: "2026-09-17T08:40:00+08:00",
    },
    {
      id: "S-260902",
      organ: "肾",
      thicknessUm: 4,
      batchId: "B-2609",
      coverslippedAt: "2026-09-17T09:20:00+08:00",
      status: "interpreted",
      restainOf: null,
      createdAt: "2026-09-17T09:00:00+08:00",
    },
    {
      id: "S-260903",
      organ: "肺",
      thicknessUm: 6,
      batchId: "B-2609",
      coverslippedAt: "2026-09-17T09:40:00+08:00",
      status: "registered",
      restainOf: null,
      createdAt: "2026-09-17T09:20:00+08:00",
    },
    {
      id: "S-260904",
      organ: "胃",
      thicknessUm: 9,
      batchId: "B-2610",
      coverslippedAt: "2026-09-18T10:00:00+08:00",
      status: "registered",
      restainOf: null,
      createdAt: "2026-09-18T09:30:00+08:00",
    },
    {
      id: "S-260905",
      organ: "皮肤",
      thicknessUm: 5,
      batchId: "B-2610",
      coverslippedAt: "2026-09-20T08:00:00+08:00",
      status: "registered",
      restainOf: null,
      createdAt: "2026-09-20T07:40:00+08:00",
    },
    {
      id: "S-260906",
      organ: "心肌",
      thicknessUm: 5,
      batchId: "B-2611",
      coverslippedAt: "2026-09-18T14:00:00+08:00",
      status: "interpreted",
      restainOf: null,
      createdAt: "2026-09-18T13:30:00+08:00",
    },
  ];

  const versions: ConclusionVersion[] = [
    {
      id: "V-S-260901-1",
      slideId: "S-260901",
      batchId: "B-2609",
      versionNo: 1,
      kind: "initial",
      conclusion: "肝小叶结构清晰，肝细胞索排列规则，未见明显脂肪变性。",
      reason: null,
      status: "current",
      createdAt: "2026-09-18T10:00:00+08:00",
    },
    {
      id: "V-S-260902-1",
      slideId: "S-260902",
      batchId: "B-2609",
      versionNo: 1,
      kind: "initial",
      conclusion: "肾小球形态正常，肾小管上皮细胞无明显肿胀。",
      reason: null,
      status: "current",
      createdAt: "2026-09-18T10:20:00+08:00",
    },
    {
      id: "V-S-260906-1",
      slideId: "S-260906",
      batchId: "B-2611",
      versionNo: 1,
      kind: "initial",
      conclusion: "心肌纤维横纹可见，间质胶原呈蓝色，分布均匀。",
      reason: null,
      status: "current",
      createdAt: "2026-09-19T09:10:00+08:00",
    },
  ];

  return { slides, batches, versions, rejects: [], conflicts: [] };
}
