/* 闭环规则验证脚本：tsc 编译后用 node 运行 */
import {
  addConclusion, audit, gateBlocks, markUnqualified, restain, seedState,
  type AppState,
} from "./domain";

const now = Date.now();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, extra ?? ""); }
}

console.log("1. 种子数据审计");
let s: AppState = seedState(now);
const c0 = audit(s, now);
check("种子数据仅含 SP-009 的 R1 遗留冲突", c0.length === 1 && c0[0].slideId === "SP-009" && c0[0].rule.startsWith("R1"), c0);
check("冲突条目含编号/批次/原值/触发规则", c0[0].batchId === "HE-260901" && c0[0].value === "9 μm" && !!c0[0].rule);

console.log("2. 判读门槛");
const slide = (id: string) => s.slides.find((x) => x.id === id)!;
const batch = (id: string) => s.batches.find((b) => b.id === id);
check("SP-003 厚度 1.5μm 被阻断", gateBlocks(slide("SP-003"), batch("HE-260915"), now).some((b) => b.includes("厚度")));
check("SP-004 封片未满 24h 被阻断", gateBlocks(slide("SP-004"), batch("HE-260915"), now).some((b) => b.includes("封片")));
check("SP-005 批次未放行被阻断", gateBlocks(slide("SP-005"), batch("WS-260918"), now).some((b) => b.includes("未放行")));
check("SP-001 门槛通过", gateBlocks(slide("SP-001"), batch("HE-260901"), now).length === 0);

console.log("3. 复核生成带原因新版本，保留旧值");
const before = slide("SP-001").versions.length;
s = addConclusion(s, "SP-001", "炎性改变", "复核发现汇管区炎细胞", "教研复核", now);
const sp1 = slide("SP-001");
check("版本数 +1", sp1.versions.length === before + 1);
check("新版本带原因", sp1.versions[2].reason === "教研复核" && sp1.versions[2].version === 3);
check("旧版本原值保留", sp1.versions[0].result === "未见异常" && sp1.versions[1].reason === "教研抽查复核");
check("版本链连续（R6 无冲突）", audit(s, now).filter((c) => c.slideId === "SP-001" && c.rule.startsWith("R6")).length === 0);

console.log("4. 重染：新建批次 + 冻结原结论");
s = restain(s, "SP-002", now);
const sp2 = slide("SP-002");
check("新建批次 HE-260901-R1 且未放行", !!batch("HE-260901-R1") && !batch("HE-260901-R1")!.released);
check("切片回到待判读并换批", sp2.status === "pending" && sp2.batchId === "HE-260901-R1");
check("原结论全部冻结", sp2.versions.every((v) => v.frozen));
check("封片时间已重设", now - sp2.mountedAt < 60_000);
check("重染后无 R5 冲突", audit(s, now).filter((c) => c.rule.startsWith("R5")).length === 0);

console.log("5. 撤回放行触发 R3 冲突（分支验证，不污染主线）");
const revoked = { ...s, batches: s.batches.map((b) => (b.id === "HE-260901" ? { ...b, released: false } : b)) };
const c5 = audit(revoked, now);
check("撤回放行 → 批内已判读切片触发 R3",
  c5.filter((c) => c.rule.startsWith("R3")).map((c) => c.slideId).sort().join(",") === "SP-001,SP-009", c5);

console.log("6. 同批不合格联动");
const matesBefore = s.slides.filter((x) => x.batchId === "HE-260901" && x.id !== "SP-001" &&
  (x.status === "pending" || x.status === "interpreted")).length;
s = markUnqualified(s, "SP-001");
const matesAfter = s.slides.filter((x) => x.batchId === "HE-260901" && x.status === "review").length;
check("SP-001 标记不合格", slide("SP-001").status === "unqualified");
check(`同批 ${matesBefore} 张全部转待复核`, matesAfter === matesBefore, { matesBefore, matesAfter });
check("联动后无 R4 冲突", audit(s, now).filter((c) => c.rule.startsWith("R4")).length === 0);

console.log("7. 持久化往返一致（模拟刷新）");
const restored: AppState = JSON.parse(JSON.stringify(s));
const ca = JSON.stringify(audit(s, now));
const cb = JSON.stringify(audit(restored, now));
check("刷新前后冲突清单一致", ca === cb);
check("刷新前后版本链一致", JSON.stringify(s.slides.map((x) => x.versions)) === JSON.stringify(restored.slides.map((x) => x.versions)));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) throw new Error(`${fail} 项失败`);
