/* 切片复核闭环：领域模型、门槛、审计与状态迁移（纯函数，无 UI 依赖） */

export const THICKNESS_MIN = 2; // μm
export const THICKNESS_MAX = 8; // μm
export const MOUNT_MIN_HOURS = 24; // 封片固化规定时间
export const STORAGE_KEY = "hxwl06-slide-review-v1";
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export const RULE_TEXT = {
  R1: `R1 厚度须在 ${THICKNESS_MIN}–${THICKNESS_MAX} μm`,
  R2: `R2 封片须满 ${MOUNT_MIN_HOURS}h`,
  R3: "R3 批次须放行后判读",
  R4: "R4 同批不合格须转待复核",
  R5: "R5 重染后原结论须冻结",
  R6: "R6 版本链须连续",
} as const;

export type SlideStatus = "pending" | "interpreted" | "review" | "unqualified";

export const STATUS_LABEL: Record<SlideStatus, string> = {
  pending: "待判读",
  interpreted: "已判读",
  review: "待复核",
  unqualified: "不合格",
};

export interface ConclusionVersion {
  version: number;
  batchId: string; // 判读时所属批次
  result: string;
  note: string;
  reason: string; // 复核原因（首判为“首次判读”）
  createdAt: number;
  frozen: boolean; // 重染后原结论冻结
}

export interface Slide {
  id: string; // 编号
  site: string; // 部位
  thickness: number; // μm
  batchId: string; // 染色批次
  mountedAt: number; // 封片时间
  status: SlideStatus;
  versions: ConclusionVersion[];
  restainCount: number;
}

export interface Batch {
  id: string;
  stain: string; // 染色方法
  createdAt: number;
  released: boolean;
  releasedAt?: number;
}

export interface AppState {
  slides: Slide[];
  batches: Batch[];
}

export interface Conflict {
  slideId: string;
  batchId: string;
  value: string; // 原值
  rule: string; // 触发规则
}

/** 判读门槛：返回阻断原因列表，空数组表示可判读 */
export function gateBlocks(slide: Slide, batch: Batch | undefined, now: number): string[] {
  const blocks: string[] = [];
  if (slide.thickness < THICKNESS_MIN || slide.thickness > THICKNESS_MAX) {
    blocks.push(`厚度 ${slide.thickness}μm 不在 ${THICKNESS_MIN}–${THICKNESS_MAX}μm`);
  }
  const hours = (now - slide.mountedAt) / HOUR;
  if (hours < MOUNT_MIN_HOURS) {
    blocks.push(`封片仅固化 ${hours.toFixed(1)}h，未满 ${MOUNT_MIN_HOURS}h`);
  }
  if (!batch || !batch.released) {
    blocks.push(`批次 ${slide.batchId} 未放行`);
  }
  return blocks;
}

/** 全量审计：切片、批次、复核状态与版本链的一致性 */
export function audit(state: AppState, now: number): Conflict[] {
  const conflicts: Conflict[] = [];
  const batchById = new Map(state.batches.map((b) => [b.id, b]));

  for (const slide of state.slides) {
    const batch = batchById.get(slide.batchId);
    const push = (value: string, rule: string) =>
      conflicts.push({ slideId: slide.id, batchId: slide.batchId, value, rule });

    // R1–R3：已判读（结论生效中）的切片必须持续满足门槛
    if (slide.status === "interpreted") {
      if (slide.thickness < THICKNESS_MIN || slide.thickness > THICKNESS_MAX) {
        push(`${slide.thickness} μm`, RULE_TEXT.R1);
      }
      const hours = (now - slide.mountedAt) / HOUR;
      if (hours < MOUNT_MIN_HOURS) {
        push(`已固化 ${hours.toFixed(1)}h`, RULE_TEXT.R2);
      }
      if (!batch || !batch.released) {
        push(batch ? "批次未放行" : "批次缺失", RULE_TEXT.R3);
      }
    }

    // R4：同批出现不合格时，其余切片须为待复核/不合格
    const mates = state.slides.filter((s) => s.batchId === slide.batchId);
    if (
      mates.some((m) => m.status === "unqualified") &&
      (slide.status === "pending" || slide.status === "interpreted")
    ) {
      push(STATUS_LABEL[slide.status], RULE_TEXT.R4);
    }

    // R5：重染后，旧批次下的结论必须冻结
    for (const v of slide.versions) {
      if (v.batchId !== slide.batchId && !v.frozen) {
        push(`v${v.version} 未冻结`, RULE_TEXT.R5);
      }
    }

    // R6：版本链必须从 1 开始连续递增
    const seq = slide.versions.map((v) => v.version);
    if (!seq.every((n, i) => n === i + 1)) {
      push(`版本序列 ${seq.join(",") || "空"}`, RULE_TEXT.R6);
    }
  }
  return conflicts;
}

function nextVersion(slide: Slide, result: string, note: string, reason: string, now: number): ConclusionVersion {
  return {
    version: slide.versions.length + 1,
    batchId: slide.batchId,
    result,
    note,
    reason,
    createdAt: now,
    frozen: false,
  };
}

function patchSlide(state: AppState, slideId: string, patch: (s: Slide) => Slide): AppState {
  return { ...state, slides: state.slides.map((s) => (s.id === slideId ? patch(s) : s)) };
}

/** 判读 / 复核：只追加带原因的新版本，保留旧值 */
export function addConclusion(state: AppState, slideId: string, result: string, note: string, reason: string, now: number): AppState {
  return patchSlide(state, slideId, (s) => ({
    ...s,
    status: "interpreted",
    versions: [...s.versions, nextVersion(s, result, note, reason, now)],
  }));
}

/** 重染：新建批次 + 冻结原结论 + 重设封片时间 + 回到待判读 */
export function restain(state: AppState, slideId: string, now: number): AppState {
  const slide = state.slides.find((s) => s.id === slideId);
  if (!slide) return state;
  const oldStain = state.batches.find((b) => b.id === slide.batchId)?.stain ?? "HE 染色";
  const newBatch: Batch = {
    id: `${slide.batchId}-R${slide.restainCount + 1}`,
    stain: oldStain,
    createdAt: now,
    released: false,
  };
  return {
    batches: [...state.batches, newBatch],
    slides: state.slides.map((s) =>
      s.id === slideId
        ? {
            ...s,
            batchId: newBatch.id,
            mountedAt: now,
            status: "pending",
            restainCount: s.restainCount + 1,
            versions: s.versions.map((v) => ({ ...v, frozen: true })),
          }
        : s
    ),
  };
}

/** 标记不合格：同批其余切片转入待复核 */
export function markUnqualified(state: AppState, slideId: string): AppState {
  const slide = state.slides.find((s) => s.id === slideId);
  if (!slide) return state;
  return {
    ...state,
    slides: state.slides.map((s) => {
      if (s.id === slideId) return { ...s, status: "unqualified" };
      if (s.batchId === slide.batchId && (s.status === "pending" || s.status === "interpreted")) {
        return { ...s, status: "review" };
      }
      return s;
    }),
  };
}

/* ================= 种子数据与持久化 ================= */

export function seedState(now: number): AppState {
  const batches: Batch[] = [
    { id: "HE-260901", stain: "HE 染色", createdAt: now - 4 * DAY, released: true, releasedAt: now - 4 * DAY + HOUR },
    { id: "HE-260915", stain: "HE 染色", createdAt: now - 3 * DAY, released: true, releasedAt: now - 3 * DAY + HOUR },
    { id: "WS-260918", stain: "瑞氏染色", createdAt: now - 2 * DAY, released: false },
    { id: "HE-260919-R1", stain: "HE 染色", createdAt: now - 3 * HOUR, released: false },
  ];
  const v = (
    version: number,
    batchId: string,
    result: string,
    note: string,
    reason: string,
    createdAt: number,
    frozen = false
  ): ConclusionVersion => ({ version, batchId, result, note, reason, createdAt, frozen });

  const slides: Slide[] = [
    {
      id: "SP-001", site: "肝组织", thickness: 4, batchId: "HE-260901", mountedAt: now - 3.5 * DAY,
      status: "interpreted", restainCount: 0,
      versions: [
        v(1, "HE-260901", "未见异常", "肝小叶结构清晰，中央静脉可见", "首次判读", now - 3 * DAY),
        v(2, "HE-260901", "未见异常", "教研抽查，维持原结论", "教研抽查复核", now - 2.5 * DAY),
      ],
    },
    {
      id: "SP-002", site: "肝组织", thickness: 6, batchId: "HE-260901", mountedAt: now - 3.5 * DAY,
      status: "interpreted", restainCount: 0,
      versions: [v(1, "HE-260901", "炎性改变", "汇管区少量炎细胞浸润", "首次判读", now - 3 * DAY)],
    },
    {
      id: "SP-003", site: "胃黏膜", thickness: 1.5, batchId: "HE-260915", mountedAt: now - 2.5 * DAY,
      status: "review", restainCount: 0, versions: [],
    },
    {
      id: "SP-004", site: "胃黏膜", thickness: 5, batchId: "HE-260915", mountedAt: now - 5 * HOUR,
      status: "review", restainCount: 0, versions: [],
    },
    {
      id: "SP-005", site: "外周血", thickness: 3, batchId: "WS-260918", mountedAt: now - 2 * DAY,
      status: "pending", restainCount: 0, versions: [],
    },
    {
      id: "SP-006", site: "肾组织", thickness: 4, batchId: "HE-260915", mountedAt: now - 2.5 * DAY,
      status: "unqualified", restainCount: 0, versions: [],
    },
    {
      id: "SP-007", site: "肾组织", thickness: 4, batchId: "HE-260915", mountedAt: now - 2.5 * DAY,
      status: "review", restainCount: 0,
      versions: [v(1, "HE-260915", "未见异常", "肾小球形态尚可", "首次判读", now - 2.4 * DAY)],
    },
    {
      id: "SP-008", site: "皮肤", thickness: 5, batchId: "HE-260919-R1", mountedAt: now - 2 * HOUR,
      status: "pending", restainCount: 1,
      versions: [v(1, "HE-260901", "细胞异型", "表皮细胞排列紊乱（重染前）", "首次判读", now - 3.2 * DAY, true)],
    },
    {
      // 历史遗留：判读后才被发现厚度超标，用于演示审计冲突
      id: "SP-009", site: "甲状腺", thickness: 9, batchId: "HE-260901", mountedAt: now - 3.5 * DAY,
      status: "interpreted", restainCount: 0,
      versions: [v(1, "HE-260901", "未见异常", "历史遗留判读，厚度待核查", "首次判读", now - 3 * DAY)],
    },
  ];
  return { slides, batches };
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!Array.isArray(parsed.slides) || !Array.isArray(parsed.batches)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
