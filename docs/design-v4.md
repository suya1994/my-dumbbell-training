# 哑铃训练应用 · 第四版修订方案（设计稿）

> 状态：仅设计文档与 SQL 草案。
> 本轮未执行任何 SQL、未读写 Supabase、未修改项目代码、未部署。
> 配套文件：`docs/sql-v4-migration.sql`、`docs/sql-v4-rpc.sql`、`docs/test-cases-v4.md`。

---

## 0. 本轮修订对照

| 你的要求 | 本版处理 |
|---|---|
| 区分循环顺序与训练编号 | 两个独立概念：`cycle_position`（A/B/C/D）与 `workout_number`（永久编号） |
| 编号只在完成保存时分配 | pending 计划不占用编号；完成 RPC 内部分配 |
| 编号永久单调递增 | 专用计数器表 `workout_number_counter`，事务内加行锁递增 |
| 不用 `MAX+1` | 计数器和 `MAX+1` 完全解耦，删除历史不回退 |
| 重复点击不产生两个编号 | 提交幂等键 + 计划行锁 + 唯一约束 |
| 编号/训练/动作记录同一事务 | 单个 PostgreSQL RPC `complete_workout` |
| 事务失败不消耗编号 | 计数器更新参与事务，异常整体回滚 |
| 删除历史只允许空缺 | 计数器不递减；`workouts.workout_number` 不可变 |
| 弹力带 10/15/20 磅 | `user_equipment` 三条独立设备，默认 15 磅，每个计划动作可独立选择 |
| 不再出现 45 磅 | 设备库、模板、提示词统一为 10/15/20；历史快照不改写 |
| SQL 真幂等 | 约束按 `conrelid + conname` 判断；索引按 `indrelid + relname` 判断；外键按列映射判断 |
| 历史快照逐列补齐 | `COALESCE(旧值, 计划值)`，只补 NULL，不覆盖 |
| 完整恢复边界 | 本阶段只开放“合并恢复”；完整恢复不放进网页，改为离线事务脚本 |
| 训练量统计 | 单循环训练量 + 按真实日期自然周训练量，两套口径 |
| 模板修正 | 侧平板不再算臀中肌；新增真正髋外展动作；分腿蹲 2 组；臂屈伸明确形式 |

---

## 1. 两个独立概念：循环顺序 vs 实际训练编号

### 1.1 定义

| 概念 | 字段 | 含义 | 何时变化 |
|---|---|---|---|
| 循环顺序 | `cycle_templates.sort_order` / `training_plans.cycle_template_id` | 当前轮到 A/B/C/D 哪一套模板 | 每完成一次训练后推进一格；修改模板不改变已生成计划 |
| 实际训练编号 | `workouts.workout_number` | 用户实际完成并保存的第 N 次训练 | 只在完成 RPC 成功提交时分配 |

两者关系：

```
循环顺序决定“练什么”
实际编号决定“这是第几次”
```

不存在“A 就是第 1 次”“B 就是第 2 次”的绑定关系。用户可以连续两次都练 B（例如调整模板或删除历史后），但编号仍然单调递增。

### 1.2 当前 pending 计划的循环顺序怎么算

```text
若存在 status='pending' 的计划：
    直接使用该计划的 cycle_template_id / cycle_code_snapshot
否则：
    取最近一个 status='completed' 且 workout_number 不为空的计划
    读取它的 cycle_template_id 对应 sort_order
    在启用模板中找 sort_order 更大的第一条
    找不到则回绕到 sort_order 最小的一条
若没有任何启用模板：
    不生成计划，首页显示“等待训练计划”
```

说明：

- 循环推进依据是**已完成计划**，不是 `MAX(workouts.workout_number)`。
- 删除某次 workout 不会让循环倒退，因为对应的 completed 计划仍然保留。
- 修改模板内容不会改变已生成计划；下一次生成才使用新内容。

### 1.3 下一次实际训练编号怎么算

```text
预计编号 = workout_number_counter.last_number + 1
```

这个值只用于**展示**，不是分配。真正分配发生在 `complete_workout` RPC 内：

```sql
update workout_number_counter
set last_number = last_number + 1
where id = 1
returning last_number;
```

### 1.4 页面标题展示规则

| 场景 | 标题 |
|---|---|
| 首页，已有 31 次完成记录，pending 计划为循环 B | `已完成 31 次训练` / `下一次：循环 B（预计第 32 次，完成时分配）` |
| 训练完成后 | `第 32 次训练 · 循环 B · 上半身 B` |
| 历史列表 | `第 31 次训练 · 循环 A · 上半身 A` |
| 历史详情 | 标题同上，编号来自 `workouts.workout_number` |
| 删除第 32 次后 | 首页仍显示 `已完成 31 次`，下一次 `预计第 33 次`，历史出现 31 → 33 的空缺 |
| 第二标签页保存时计划已被完成 | 返回 `ALREADY_COMPLETED`，不分配新编号，提示刷新 |

**强制规则：**

- pending 阶段只能写“预计第 N 次”，不能写“第 N 次”。
- 完成成功后，必须使用 RPC 返回的 `workout_number` 渲染，不能前端自己 +1。
- 历史页、详情页、统计页一律读取 `workouts.workout_number`，不重新推算。

---

## 2. 修订后的整体架构与不变式

```text
动作库
  exercises ──< exercise_aliases
      └──────< exercise_muscle_groups

设备库
  user_equipment

循环模板
  cycle_templates ──< cycle_template_exercises

训练实例（计划侧）
  training_plans ──< training_plan_exercises
        └──────────< plan_versions

训练历史（记录侧）
  workouts ──< workout_exercise_records（自包含快照）

编号
  workout_number_counter（单行计数器）
```

### 不变式

| # | 不变式 |
|---|---|
| I1 | 循环顺序只由模板 `sort_order` 决定，与日期、星期无关 |
| I2 | 实际编号只由计数器分配，与循环顺序无关 |
| I3 | 同一时间最多一条 `status='pending'` 计划（数据库唯一索引强制） |
| I4 | pending 计划不占用实际编号；只有完成 RPC 成功才占用 |
| I5 | 编号单调递增，删除历史只产生空缺，不回收、不复用 |
| I6 | 已完成计划不可删除、不可回退为 pending、编号不可改 |
| I7 | 模板修改不影响已生成计划；计划内保存模板内容快照 |
| I8 | 历史记录自包含：动作名、设备、阻力、计划值、实际值、来源均写在 record 内 |
| I9 | 旧记录 `actual_source` 保持 NULL；`plan_default` 只用于改造后系统自动继承 |
| I10 | 训练保存 = 单个数据库事务，失败不留下半条训练，也不消耗编号 |
| I11 | 动作库/设备库只允许归档（`is_active=false`），不允许删除有引用者 |

---

## 3. 编号持久化、分配与防重复机制

### 3.1 为什么不用 PostgreSQL sequence

`nextval()` 不在事务内回滚：事务失败也会消耗一个值，产生无法解释的空缺。你的要求是“事务失败不能消耗编号”，因此不能把 sequence 作为编号来源。

采用**单行计数器表**：

```sql
create table public.workout_number_counter (
  id          smallint primary key default 1 check (id = 1),
  last_number integer not null default 0 check (last_number >= 0),
  updated_at  timestamptz not null default now()
);
```

- `UPDATE ... RETURNING` 对行加锁，天然串行化并发完成请求。
- 回滚时 `last_number` 一起回滚。
- 删除 workout 不执行任何计数器递减。
- 恢复备份时只允许调高，不允许调低。

### 3.2 四层防重复

| 层 | 机制 | 防什么 |
|---|---|---|
| L1 提交幂等 | `workouts.submission_key` 唯一索引 | 同一按钮重复点击、网络重试 |
| L2 计划行锁 | `SELECT ... FOR UPDATE` on `training_plans` | 两个标签页同时完成同一计划 |
| L3 计划唯一 | `workouts.training_plan_id` 唯一索引 | 同一计划生成两条 workout |
| L4 待办唯一 | `plans_single_pending` 部分唯一索引 | 重复生成 pending 计划 |

### 3.3 完成保存的原子流程

```text
POST RPC complete_workout(plan_id, submission_key, ...)
  BEGIN
    1. 若 submission_key 已存在 → 返回原结果（replayed=true），不分配编号
    2. SELECT plan FOR UPDATE
    3. 校验 plan.status='pending'
       - 若已 completed 且同一 submission_key → 返回原结果
       - 若已 completed 但不同 key → 报 ALREADY_COMPLETED
    4. 校验动作条目数量、ID 归属、无重复、难度合法
    5. UPDATE counter SET last_number=last_number+1 RETURNING
    6. INSERT workouts（编号、日期、计划快照、submission_key）
    7. INSERT workout_exercise_records（计划快照 + 实际值 + 来源）
    8. 重算 completion_percent，UPDATE workouts
    9. UPDATE plan SET status='completed', workout_number=编号
   10. INSERT plan_versions（applied 快照）
   11. 返回 workout_id / workout_number / cycle_code
  COMMIT
```

任一步失败：整个事务回滚，编号不消耗，workout 和 records 都不存在，计划仍是 pending。

### 3.4 删除历史训练后的编号行为

```text
完成第 32 次 → counter = 32
删除第 32 次 → counter 仍 = 32
下一次完成   → counter = 33
历史列表     → 31, 33（允许空缺）
```

不会出现“删除 32 后下一次又变 32”。

### 3.5 循环推进不受删除影响

循环推进读取最近一个 `status='completed'` 的计划，而不是最近一条 workout。删除 workout 不会删除计划，因此：

```text
第 32 次循环 B 完成 → 删除第 32 次记录
下一次计划 = 循环 C（不是重新 B）
下一次编号 = 33
```

如果你希望“删除后重练同一循环”，需要显式在计划页选择“重练循环 B”，这会替换 pending 计划，但不改变编号。

---

## 4. 数据库表结构与字段变更

### 4.1 新增表

| 表 | 作用 | 关键字段 |
|---|---|---|
| `exercises` | 规范动作库 | `name`、`name_normalized`、`category`、`exercise_mode`、`equipment_hint`、`is_active` |
| `exercise_aliases` | 同义名/历史名映射 | `exercise_id`、`alias`、`alias_normalized` |
| `exercise_muscle_groups` | 动作肌群 | `exercise_id`、`muscle_group`、`role` |
| `user_equipment` | 设备库 | `name`、`category`、`resistance_lb`、`resistance_kg`、`is_active` |
| `cycle_templates` | A/B/C/D 模板 | `code`、`name`、`focus`、`duration_minutes`、`sort_order`、`is_active` |
| `cycle_template_exercises` | 模板动作 | `template_id`、`exercise_id`、`phase`、`weight_kg`、`resistance_lb`、`reps`、`sets`、`rest_seconds` |
| `plan_versions` | 计划版本快照 | `plan_id`、`workout_number`、`version_no`、`source`、`status`、`snapshot` |
| `workout_number_counter` | 永久编号计数器 | `id=1`、`last_number` |

### 4.2 现有表新增字段

#### `training_plans`

| 字段 | 类型 | 说明 |
|---|---|---|
| `cycle_template_id` | bigint | 来源模板，删除模板受 RESTRICT 保护 |
| `cycle_code_snapshot` | text | 生成时的 A/B/C/D 快照 |
| `cycle_name_snapshot` | text | 生成时的模板名快照 |
| `source` | text | `cycle_template/ai/manual/legacy/import` |
| `status` | text | `pending/completed/archived` |
| `content_hash` | text | 防重复导入 |
| `updated_at` | timestamptz | 更新时间 |
| `workout_number` | int | **改为可空**；pending 为 NULL，完成时写入 |

#### `training_plan_exercises`

| 字段 | 类型 | 说明 |
|---|---|---|
| `exercise_id` | bigint | 指向动作库，RESTRICT |
| `phase` | text | `warmup/main/cooldown` |
| `duration_seconds` | int | 计时动作 |
| `rest_seconds` | int | 休息 |
| `equipment_id` | bigint | 设备库，RESTRICT |
| `resistance_lb` | numeric | 该计划动作独立选择的弹力带磅数（10/15/20，默认 15） |
| `resistance_kg` | numeric | 按磅数换算的计划阻力 |
| `equipment_snapshot` | text | 生成时设备文本快照 |
| `updated_at` | timestamptz | 更新时间 |

#### `workouts`

| 字段 | 类型 | 说明 |
|---|---|---|
| `training_plan_id` | bigint | 对应计划，唯一，RESTRICT |
| `cycle_template_id` | bigint | 完成时的模板 |
| `cycle_code_snapshot` | text | 完成时的循环快照 |
| `cycle_name_snapshot` | text | 完成时的循环名快照 |
| `plan_version_id` | bigint | 应用的计划版本 |
| `submission_key` | text | 幂等键，唯一 |
| `updated_at` | timestamptz | 更新时间 |

#### `workout_exercise_records`

| 字段 | 类型 | 说明 |
|---|---|---|
| `exercise_id_snapshot` | bigint | 动作库 ID 快照 |
| `exercise_name_snapshot` | text | 动作名快照 |
| `equipment_snapshot` | text | 设备文本快照 |
| `equipment_id_snapshot` | bigint | 设备 ID 快照 |
| `resistance_lb_snapshot` | numeric | 阻力磅数快照 |
| `resistance_kg_snapshot` | numeric | 阻力公斤快照 |
| `planned_resistance_lb` | numeric | 计划阻力磅数 |
| `planned_resistance_kg` | numeric | 计划阻力公斤 |
| `actual_resistance_lb` | numeric | 实际阻力磅数，历史保持 NULL |
| `actual_resistance_kg` | numeric | 实际阻力公斤，历史保持 NULL |
| `planned_weight_kg` | numeric | 计划重量 |
| `planned_reps` | text | 计划次数 |
| `planned_sets` | int | 计划组数 |
| `planned_duration_seconds` | int | 计划时长 |
| `planned_rest_seconds` | int | 计划休息 |
| `actual_weight_kg` | numeric | 实际重量，历史保持 NULL |
| `actual_reps` | text | 实际次数，历史保持 NULL |
| `actual_sets` | int | 实际组数，历史保持 NULL |
| `actual_duration_seconds` | int | 实际时长，历史保持 NULL |
| `actual_source` | text | NULL / `plan_default` / `user_confirmed` |
| `note` | text | 本次动作备注 |
| `snapshot_source` | text | `rpc` / `legacy_backfill` |
| `snapshot_filled_at` | timestamptz | 快照补齐时间 |

### 4.3 关系与删除规则

| 父表 | 子表 | ON DELETE |
|---|---|---|
| `training_plans` | `training_plan_exercises` | CASCADE（但 completed 计划被触发器禁止删除） |
| `training_plan_exercises` | `workout_exercise_records` | **RESTRICT**（有历史就删不掉） |
| `workouts` | `workout_exercise_records` | CASCADE（用户显式删除整次训练时） |
| `exercises` | `training_plan_exercises` | RESTRICT |
| `exercises` | `cycle_template_exercises` | RESTRICT |
| `user_equipment` | `training_plan_exercises` / `cycle_template_exercises` | RESTRICT |
| `cycle_templates` | `training_plans` / `cycle_template_exercises` | RESTRICT |
| `training_plans` | `workouts.training_plan_id` | RESTRICT |
| `training_plans` | `plan_versions.plan_id` | SET NULL |

> 退役动作/设备/模板一律 `is_active=false`，不删除。

---

## 5. SQL 幂等性原则

### 5.1 三类执行状态

| 对象 | 未执行过 | 已完整执行过 | 部分执行过 |
|---|---|---|---|
| `CREATE TABLE IF NOT EXISTS` | 建表 | 跳过 | 跳过；随后 `ADD COLUMN IF NOT EXISTS` 补列 |
| `ADD COLUMN IF NOT EXISTS` | 加列 | 跳过 | 只补缺失列 |
| 约束 `DO` 块 | 添加 | 跳过 | 添加 |
| 索引 `DO` 块 | 创建 | 跳过 | 创建缺失索引 |
| 外键迁移 `DO` 块 | 添加 | 跳过 | 补建或替换错误删除规则 |
| 触发器 | 创建 | 先 DROP 再 CREATE | 先 DROP 再 CREATE |
| 函数 | 创建 | `CREATE OR REPLACE` | 覆盖 |
| 数据回填 | 写入 | 条件不满足，跳过 | 只补 NULL |
| 种子数据 | 插入 | `ON CONFLICT DO NOTHING` | 只补缺失 |
| 计数器 | 初始化 | `GREATEST` 不降低 | 调高到正确值 |
| 序列 | `setval` | 重复设置同值 | 修正到 `max(id)` |

### 5.2 约束不能只看 conname

错误写法：

```sql
-- 错：其他表也可能有同名约束
if not exists (select 1 from pg_constraint where conname = 'plans_status_chk') then ...
```

正确写法：

```sql
if not exists (
  select 1 from pg_constraint
  where conrelid = 'public.training_plans'::regclass
    and conname = 'plans_status_chk'
) then ...
```

### 5.3 索引不能只看 indexname

索引名在 schema 内唯一；如果同名索引建在别的表上，`CREATE INDEX IF NOT EXISTS` 会静默跳过，导致目标表缺索引。

正确写法：

```sql
if not exists (
  select 1
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  where i.indrelid = 'public.training_plan_exercises'::regclass
    and c.relname = 'idx_pe_plan'
) then
  execute 'create index idx_pe_plan on public.training_plan_exercises (plan_id, exercise_order)';
end if;
```

### 5.4 外键迁移必须比对列映射

不能只看“是否已存在指向 `training_plan_exercises` 的 RESTRICT 外键”。必须同时比对：

- 引用表：`workout_exercise_records`
- 引用列：`plan_exercise_id`
- 被引用表：`training_plan_exercises`
- 被引用列：`id`
- 删除行为：`confdeltype='r'`（RESTRICT）

详见 `docs/sql-v4-migration.sql` 第 6 节。

### 5.5 幂等验收

1. 整段脚本外层包 `begin; ... commit;`。
2. 连续执行两次；第二次不得报错。
3. 两次执行后对象数量、定义完全一致。
4. 额外做“部分执行”演练：删除一个列、一个约束、一个索引，再执行，必须自动补齐。

---

## 6. 历史快照补齐与历史独立性

### 6.1 原则

- 历史 `actual_*` 缺失时保持 NULL，绝不拿计划值伪造。
- 历史 `actual_source` 保持 NULL，语义为“改造前，来源未知”。
- 只补“计划侧快照”：动作名、设备、阻力、计划重量、计划次数、计划组数、计划时长、计划休息。
- 逐列 `COALESCE(旧值, 计划值)`，已有快照绝不覆盖。
- `snapshot_source='legacy_backfill'`、`snapshot_filled_at` 记录补齐来源，便于审计。

### 6.2 逐列回填 SQL 逻辑

```sql
update public.workout_exercise_records r
set exercise_id_snapshot       = coalesce(r.exercise_id_snapshot, pe.exercise_id),
    exercise_name_snapshot     = coalesce(r.exercise_name_snapshot, pe.exercise_name),
    equipment_snapshot         = coalesce(r.equipment_snapshot, pe.equipment_snapshot, pe.equipment),
    equipment_id_snapshot      = coalesce(r.equipment_id_snapshot, pe.equipment_id),
    resistance_lb_snapshot     = coalesce(r.resistance_lb_snapshot, pe.resistance_lb),
    resistance_kg_snapshot     = coalesce(r.resistance_kg_snapshot, pe.resistance_kg),
    planned_resistance_lb      = coalesce(r.planned_resistance_lb, pe.resistance_lb),
    planned_resistance_kg      = coalesce(r.planned_resistance_kg, pe.resistance_kg),
    planned_weight_kg          = coalesce(r.planned_weight_kg, pe.weight_kg),
    planned_reps               = coalesce(r.planned_reps, pe.reps),
    planned_sets               = coalesce(r.planned_sets, pe.sets),
    planned_duration_seconds   = coalesce(r.planned_duration_seconds, pe.duration_seconds),
    planned_rest_seconds       = coalesce(r.planned_rest_seconds, pe.rest_seconds),
    snapshot_source            = coalesce(r.snapshot_source, 'legacy_backfill'),
    snapshot_filled_at         = coalesce(r.snapshot_filled_at, now())
from public.training_plan_exercises pe
where pe.id = r.plan_exercise_id
  and (
    r.exercise_name_snapshot is null
    or r.planned_sets is null
    or r.planned_resistance_lb is null
    or r.snapshot_filled_at is null
  );
```

注意：

- 自重动作的 `pe.weight_kg` 本身就是 NULL，回填后仍为 NULL，不会伪造 0。
- 重复执行只补 NULL；已有值不覆盖。
- **没有任何一条 UPDATE 写 `actual_weight_kg` / `actual_reps` / `actual_sets` / `actual_duration_seconds` / `actual_resistance_*` / `actual_source`。**

### 6.3 历史展示不依赖 JOIN

历史详情必须直接读取 `workout_exercise_records` 的以下列：

- `exercise_name_snapshot`
- `equipment_snapshot`
- `resistance_lb_snapshot` / `resistance_kg_snapshot`
- `planned_*`
- `actual_*`
- `actual_source`
- `note`

不能为了显示历史去 JOIN `exercises`、`user_equipment`、`training_plan_exercises`。这样即使动作库改名、设备退役、模板重写、计划归档，历史展示都不变。

### 6.4 历史保护触发器

| 触发器 | 行为 |
|---|---|
| `trg_workouts_number_immutable` | 禁止 UPDATE 修改 `workouts.workout_number` |
| `trg_plans_completed_guard` | completed 计划禁止回退为 pending/archived，禁止改编号 |
| `trg_plans_completed_delete` | completed 计划禁止 DELETE |
| `werec_plan_exercise_fk ... ON DELETE RESTRICT` | 有动作记录的 plan_exercise 删不掉 |

> 离线完整恢复脚本如需删除 completed 计划，必须先显式 `ALTER TABLE ... DISABLE TRIGGER`，并在同一事务内恢复；网页端不提供此能力。

---

## 7. 原子化训练保存 RPC

### 7.1 函数签名

```sql
public.complete_workout(
  p_plan_id                 bigint,
  p_submission_key          text,
  p_workout_date            date,
  p_actual_duration_minutes integer,
  p_body_note               text,
  p_items                   jsonb
) returns jsonb
```

`p_items` 结构：

```json
[
  {
    "plan_exercise_id": 123,
    "completed": true,
    "difficulty": "normal",
    "modified": false,
    "actual_weight_kg": null,
    "actual_reps": null,
    "actual_sets": null,
    "actual_duration_seconds": null,
    "note": null
  }
]
```

字段语义：

| 字段 | 必填 | 说明 |
|---|---|---|
| `plan_exercise_id` | 是 | 必须属于该 plan |
| `completed` | 否 | 默认 true |
| `difficulty` | 否 | null / easy / normal / hard / incomplete；null 合法 |
| `modified` | 否 | 默认 false；true 表示用户展开改过 |
| `actual_*` | 否 | `modified=false` 时忽略，服务端用计划值；弹力带可含 `actual_resistance_lb/kg` |
| `note` | 否 | 单动作备注 |

### 7.2 服务端写入规则

| 场景 | actual_* | actual_source |
|---|---|---|
| 未修改、已完成 | 计划值 | `plan_default` |
| 展开修改、已完成 | 用户值，缺省回退计划值 | `user_confirmed` |
| 未完成 | NULL | NULL |
| 难度未点、已完成 | 计划值 | `plan_default` |
| 历史旧记录 | 保持 NULL | 保持 NULL |

快照字段（`exercise_name_snapshot`、`equipment_*`、`planned_*`）全部由服务端从 `training_plan_exercises` 读取，**不信任前端传值**。

阻力字段分开保存：

| 字段 | 来源 | 历史旧记录 |
|---|---|---|
| `resistance_lb_snapshot` / `resistance_kg_snapshot` | 完成时的设备阻力快照 | 从历史文本回填 15 磅 |
| `planned_resistance_lb` / `planned_resistance_kg` | 来自 `training_plan_exercises.resistance_lb/kg` | 回填计划值 |
| `actual_resistance_lb` / `actual_resistance_kg` | 用户确认的实际阻力；未修改时默认计划值 | 保持 NULL |

### 7.3 返回结构

```json
{
  "ok": true,
  "replayed": false,
  "workout_id": 1234,
  "workout_number": 32,
  "cycle_code": "B",
  "cycle_name": "臀部与核心 A",
  "completion_percent": 100
}
```

重复请求返回：

```json
{ "ok": true, "replayed": true, "workout_id": 1234, "workout_number": 32 }
```

### 7.4 错误码

| 错误码 | 含义 |
|---|---|
| `PLAN_NOT_FOUND` | 计划不存在 |
| `PLAN_NOT_PENDING` | 计划不是 pending |
| `ALREADY_COMPLETED` | 已被其他提交完成 |
| `ITEM_COUNT_MISMATCH` | 提交动作数与计划不一致 |
| `INVALID_PLAN_EXERCISE` | 动作不属于该计划 |
| `DUPLICATE_ITEM` | 同一动作提交两次 |
| `INVALID_DIFFICULTY` | 难度值非法 |
| `INVALID_DURATION` | 实际时长非法 |
| `COUNTER_NOT_INITIALIZED` | 计数器未初始化 |
| `SUBMISSION_KEY_REUSED` | 同一幂等键用于不同计划 |

### 7.5 完整 SQL

见 `docs/sql-v4-rpc.sql`。关键点：

- 函数默认 `security invoker`，显式 `set search_path = public, pg_temp`。
- 不加异常吞噬；任何 `raise` 都让事务整体回滚。
- 计数器更新在动作校验之后、workout 插入之前。
- `submission_key` 唯一索引由数据库兜底。
- `training_plans` 行锁保证两个标签页串行。
- 该函数只允许完成 pending 计划，不能改历史编号。

### 7.6 权限与限制

当前项目没有登录、没有 RLS，anon key 可写多张表。RPC 不会让风险显著变大，但必须明确：

- 持有 anon key 的人仍可直接 POST `workouts`，绕过计数器。
- 本轮不改 GRANT/RLS（按你的既定要求）。
- 因此“编号完整性”只对通过应用/RPC 的路径成立。
- 若需要数据库级强制，后续需收回 `workouts` 直接写权限，并把删除训练也改为 RPC；本阶段暂不开放。

---

## 8. 弹力带设备库（10/15/20 磅）

### 8.1 设备记录

`user_equipment` 中三条弹力带记录 + 一条哑铃记录：

| name | category | resistance_lb | resistance_kg | weight_kg | 状态 |
|---|---|---|---|---|---|
| 弹力带 10磅 | 弹力带 | 10 | 4.54 | NULL | 可选 |
| 弹力带 15磅 | 弹力带 | 15 | 6.80 | NULL | **默认** |
| 弹力带 20磅 | 弹力带 | 20 | 9.07 | NULL | 可选 |
| 哑铃 5kg | 哑铃 | NULL | NULL | 5.00 | 当前唯一哑铃 |

约束：

```sql
unique (name)
unique (category, resistance_lb) where resistance_lb is not null and is_active
check (resistance_lb is null or resistance_lb > 0)
check (resistance_kg is null or resistance_kg > 0)
check (weight_kg is null or weight_kg > 0)
```

> 唯一索引只约束 `is_active = true` 的行：历史停用设备可以保留自己的阻力值，不会与当前三条弹力带冲突。停用行仍可被历史计划/记录引用，但不能再被新计划选中。

### 8.2 计划动作记录（每个动作独立选择阻力）

`training_plan_exercises` 中弹力带动作必须同时有：

- `equipment_id`：指向实际选用的 10 / 15 / 20 磅记录
- `resistance_lb`：该动作自己的磅数，允许 10 / 15 / 20
- `resistance_kg`：按磅数换算（10→4.54、15→6.80、20→9.07）
- `equipment_snapshot`：如 `弹力带 15磅`
- 原 `equipment` 文本保留，供旧页面兼容

规则：

1. 模板生成计划时默认写入 15 磅。
2. 生成后每个计划动作可独立改为 10 或 20 磅，不影响其他动作、其他计划或模板。
3. 面拉、髋外展等控制要求高的动作，允许默认或调整为 10 磅；不强制全部 15 磅。
4. 不允许只写“弹力带”，`resistance_lb` 不能为 NULL（弹力带动作）。
5. 计划值与实际值分开：`planned_resistance_*` 是计划目标，`actual_resistance_*` 是实际完成；后者历史保持 NULL。
6. 修改计划动作阻力只更新计划，不改变已保存的历史快照。

### 8.3 历史快照

完成训练时，`workout_exercise_records` 写入：

- `equipment_snapshot`
- `equipment_id_snapshot`
- `resistance_lb_snapshot`
- `resistance_kg_snapshot`
- `planned_resistance_lb` / `planned_resistance_kg`
- `actual_resistance_lb` / `actual_resistance_kg`（历史保持 NULL）

后续把模板从 15 磅改成 20 磅、把某个计划动作改成 10 磅、或把设备改名，都不会改变历史记录。

### 8.4 45 磅清理

- 历史计划文本中实际记录的是 `15磅弹力绳 / 6.8kg`，不改写。
- `user_settings.ai_behavior`、`js/ai-plan.js` 提示词中的 45 磅属于当前配置/代码，阶段 2 统一改为“10/15/20 磅，默认 15 磅”。
- 迁移脚本提供只读审计：

```sql
select id, workout_number, exercise_name, equipment
from training_plan_exercises
where equipment like '%45%';
```

预期 0 行；若有，逐条人工确认，不自动改成 15。

### 8.5 历史阻力的回填边界

历史文本中只有 `15磅`，因此回填：

```sql
resistance_lb_snapshot = 15
resistance_kg_snapshot = 6.80
snapshot_source = 'legacy_backfill'
```

这是从历史文本解析，不是伪造实际完成值。`actual_*` 仍为 NULL。

迁移自检 10.13 要求 `equipment like '%弹力%'` 的计划动作 `resistance_lb` 不为 NULL；若历史文本没有磅数，会显示为非 0，需人工确认后再决定是否补默认值，不静默猜测。

---

## 9. 备份、合并恢复、完整恢复的边界

### 9.1 导出 v2

```json
{
  "app": "my-dumbbell-training",
  "version": 2,
  "exported_at": "...",
  "counts": { "workouts": 31, "...": 0 },
  "counter": { "last_number": 31 },
  "tables": {
    "exercises": [],
    "exercise_aliases": [],
    "exercise_muscle_groups": [],
    "user_equipment": [],
    "cycle_templates": [],
    "cycle_template_exercises": [],
    "user_settings": [],
    "training_plans": [],
    "training_plan_exercises": [],
    "plan_versions": [],
    "workouts": [],
    "workout_exercise_records": [],
    "other_activities": [],
    "body_metrics": []
  }
}
```

导入顺序（父 → 子）：

```text
exercises → exercise_aliases → exercise_muscle_groups → user_equipment
→ cycle_templates → cycle_template_exercises → user_settings
→ training_plans → training_plan_exercises → plan_versions
→ workouts → workout_exercise_records → other_activities → body_metrics
→ workout_number_counter（最后按 GREATEST 合并）
```

### 9.2 合并恢复（本阶段唯一开放）

规则：

- 只 `POST`，`resolution=ignore-duplicates`。
- 绝不 PATCH，绝不 DELETE。
- 每张表导入前做外键预检：
  - 计划动作的 `plan_id` 是否存在于本地或本次备份；
  - 动作记录的 `workout_id` / `plan_exercise_id` 是否存在；
  - 模板动作的 `template_id` / `exercise_id` 是否存在；
  - workout 的 `training_plan_id` 是否存在。
- 缺依赖的行跳过并汇总，不静默插入 NULL 外键。
- 同 ID 但关键内容不同：本地优先，报告“ID 冲突”，由你决定是否人工处理。
- 合并后计数器：

```sql
last_number = greatest(
  当前 last_number,
  备份 counter.last_number,
  (select coalesce(max(workout_number),0) from workouts)
)
```

### 9.3 完整恢复（本阶段不开放网页入口）

原因：

1. 网页端跨多张表的 DELETE + INSERT 无法保证单事务。
2. 之前用“无匹配行 DELETE 返回 204”判断权限不可靠。
3. 若要 RPC 化，必须 `security definer` 且向 anon 暴露清库能力；在无登录的公开站点上风险不可接受。

本阶段边界：

- 网页只提供“合并恢复”。
- 完整恢复改为**离线 SQL 脚本**，由你在 Supabase SQL Editor 手动执行。
- 页面最多提供“导出完整恢复 SQL”与操作说明，**不执行**。
- 下载备份文件不等于已保存；离线恢复前必须由你明确确认“备份文件已保存到本机/其他位置”。

离线完整恢复要求：

```text
1. 先导出并确认保存当前 v2 备份
2. 在 SQL Editor 中 BEGIN
3. 按子 → 父顺序 DELETE
4. 按父 → 子顺序 INSERT
5. 恢复 workout_number_counter 为备份值（且不低于 max(workout_number)）
6. setval 所有 identity 序列
7. 运行恢复后校验
8. 全部通过才 COMMIT；任一失败 ROLLBACK
```

### 9.4 恢复后校验

| 检查 | 通过标准 |
|---|---|
| 表条数 | 与 `counts` 一致 |
| 编号 | `max(workout_number)` 与备份一致；允许历史空缺 |
| 计数器 | `last_number >= max(workout_number)` |
| 孤儿计划动作 | 0 |
| 孤儿动作记录 | 0 |
| 孤儿模板动作 | 0 |
| 动作库覆盖 | 计划动作 `exercise_id is null` → 0（阶段 1 完成后） |
| pending 唯一 | 最多 1 条 |
| 序列 | 每张表 `nextval` 大于 `max(id)` |

### 9.5 v1 兼容

- `version=1` 只导入旧 7 表，按旧顺序。
- 导入后执行计数器合并与序列修复。
- v1 没有 `actual_source`，导入后保持 NULL。
- v1 没有快照列，导入后由第 6 节回填逻辑补齐计划侧快照。

---

## 10. 修订后的 A/B/C/D 循环模板

> 说明：
> - 标记“已有”= 第 26–31 次历史计划中出现过的动作。
> - 标记“★新增”= 相对第 26–31 次历史计划，本版新加入 A/B/C/D 模板的动作；其中多数在更早历史中出现过，**真正全新只有 4 个**（弹力带三头下压、弹力带面拉、弹力带髋外展、侧平板支撑）。
> - 弹力带默认 15 磅（6.80 kg）；每个计划动作可独立选择 10/15/20 磅，面拉/髋外展允许 10 磅。
> - 所有时间估算只是初值，最终以 `actual_duration_minutes` 实测校准。
> - 不含任何星期信息。
> - 已启用“上半身维持选项”：A 单臂划船 4 组、C 直臂下压 4 组、C 面拉 3 组。
> - 肱三头肌统一用弹力带三头下压，默认 15 磅（可 10/20 磅），不使用仰卧单哑铃臂屈伸。
> - 专项核心训练量为 18 组/循环（腹部直接 2 + 核心稳定 16，为“专项核心合计”；腹部直接 2 组），执行 4 周后评估；核心间接另计 13，核心稳定及间接合计 29 组。

### 10.1 训练 A · 上半身 A｜水平推拉 + 手臂（约 44–48 分钟）

| 顺序 | 动作 | 组 × 次 | 重量/阻力 | 休息 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 1 | 猫牛式 | 1 × 8–10 | 自重 | 30s | 已有 | 热身 |
| 2 | 肩部动态活动 | 1 × 8–10 | 自重 | 30s | 已有 | 热身 |
| 3 | 仰卧肩臂滑动 | 1 × 8–10 | 自重 | 30s | 已有 | 热身 |
| 4 | 双哑铃肩推 | 3 × 6 | 5kg/手 | 90s | 已有 | 躯干稳定，不后仰 |
| 5 | 椅子支撑单臂哑铃划船 | **4 × 8/侧** | 5kg | 90s | ★新增 | 左侧先做，右侧不超过左侧 |
| 6 | 哑铃地板卧推 | 3 × 10–12 | 5kg/手 | 90s | 已有 | 肩胛稳定，可控 |
| 7 | 双臂弹力带划船 | 3 × 10–12 | 15磅 | 75s | 已有 | 不耸肩、不后仰 |
| 8 | 双哑铃弯举 | 3 × 5–6 | 5kg/手 | 60s | 已有 | 肘部固定 |
| 9 | 弹力带三头下压 | 2 × 10–12 | 15磅（可 10/20） | 60s | ★新增 | 肘部固定，只伸前臂 |
| 10 | 门框胸肩拉伸 | 1 × 30s/侧 | — | — | 已有 | 收尾 |
| 11 | 婴儿式 | 1 × 45s | — | — | 已有 | 收尾 |

**肱三头说明：** 使用 `弹力带三头下压` 15 磅（可调 10/20 磅），站姿或跪姿、肘部固定在体侧，只做伸肘。不使用仰卧单哑铃臂屈伸。

### 10.2 训练 B · 臀部与核心 A｜髋铰链 + 抗旋转（约 42–46 分钟）

| 顺序 | 动作 | 组 × 次 | 重量/阻力 | 休息 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 1 | 猫牛式 | 1 × 8–10 | 自重 | 30s | 已有 | 热身 |
| 2 | 髋部动态活动 | 1 × 8/侧 | 自重 | 30s | 已有 | 热身 |
| 3 | 徒手臀桥 | 1 × 12 | 自重 | 30s | ★新增 | 激活 |
| 4 | 单哑铃臀桥 | 3 × 12–15 | 5kg | 90s | ★新增 | 顶峰收缩 1 秒 |
| 5 | 墙辅助单腿髋铰链 | 3 × 8/侧 | 自重 | 75s | 已有 | 左侧先做；腰发力立即减幅 |
| 6 | 帕洛夫抗旋转 | 3 × 8–10/侧 | 15磅 | 60s | 已有 | 骨盆与胸口朝前 |
| 7 | 死虫 | 3 × 8/侧 | 自重 | 60s | 已有 | 腰不离地 |
| 8 | 前臂平板支撑 | 3 × 20–30s | 自重 | 60s | 已有 | 腰下沉即停 |
| 9 | 反向卷腹 | 2 × 10–12 | 自重 | 60s | ★新增 | 不甩腿 |
| 10 | 坐姿4字臀肌拉伸 | 1 × 30s/侧 | — | — | 已有 | 收尾 |
| 11 | 髋屈肌拉伸 | 1 × 30s/侧 | — | — | ★新增 | 收尾 |

### 10.3 训练 C · 上半身 B｜垂直推 + 背线 + 肩中后束（约 52–56 分钟）

| 顺序 | 动作 | 组 × 次 | 重量/阻力 | 休息 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 1 | 猫牛式 | 1 × 8–10 | 自重 | 30s | 已有 | 热身 |
| 2 | 肩部动态活动 | 1 × 8–10 | 自重 | 30s | 已有 | 热身 |
| 3 | 仰卧肩臂滑动 | 1 × 8–10 | 自重 | 30s | 已有 | 热身 |
| 4 | 站姿单臂肩推 | 3 × 6/侧 | 5kg | 90s | ★新增 | 左侧先做，不耸肩 |
| 5 | 弹力带直臂下压 | **4 × 10–12** | 15磅 | 75s | 已有 | 背阔主导，不摆腰 |
| 6 | 弹力带单臂划船 | 3 × 10/侧 | 15磅 | 75s | ★新增 | 躯干不后仰 |
| 7 | 单臂弹力带侧平举 | 3 × 8–10/侧 | 15磅 | 60s | 已有 | 左侧先做，避免耸肩 |
| 8 | 弹力带面拉 | **3 × 12–15** | 15磅（可 10） | 60s | ★新增 | 肩后束/上背，不耸肩 |
| 9 | 单臂哑铃弯举 | 3 × 6/侧 | 5kg | 60s | ★新增 | 与 A 的双手弯举交替 |
| 10 | 弹力带三头下压 | 2 × 10–12 | 15磅（可 10/20） | 60s | ★新增 | 肘部固定，只伸前臂 |
| 11 | 哑铃地板卧推 | 3 × 12 | 5kg/手 | 75s | 已有 | 胸部维持，不追重量 |
| 12 | 门框胸肩拉伸 | 1 × 30s/侧 | — | — | 已有 | 收尾 |
| 13 | 婴儿式 | 1 × 45s | — | — | 已有 | 收尾 |

### 10.4 训练 D · 臀部与核心 B｜单腿 + 髋外展 + 小腿（约 42–46 分钟）

| 顺序 | 动作 | 组 × 次 | 重量/阻力 | 休息 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 1 | 髋部动态活动 | 1 × 8/侧 | 自重 | 30s | 已有 | 热身 |
| 2 | 猫牛式 | 1 × 8–10 | 自重 | 30s | 已有 | 热身 |
| 3 | 徒手臀桥 | 1 × 12 | 自重 | 30s | ★新增 | 激活 |
| 4 | 椅子支撑分腿蹲 | **2 × 6–8/侧** | 自重 → 5kg | 90s | ★新增 | 左侧先做，膝对脚尖；先 2 组 |
| 5 | 农夫走 | 2 × 20–30 步 | 5kg/手 | 75s | ★新增 | 核心与握力 |
| 6 | 鸟狗式 | 3 × 8/侧 | 自重 | 60s | ★新增 | 骨盆不旋转 |
| 7 | 侧平板支撑 | 2 × 20–30s/侧 | 自重 | 60s | ★新增 | **只算核心稳定，不算臀中肌** |
| 8 | 弹力带髋外展 | 2 × 12–15/侧 | 15磅（可 10） | 45s | ★新增 | 站姿或侧卧，真正针对臀中肌 |
| 9 | 双腿哑铃提踵 | 3 × 15 | 5kg | 45s | ★新增 | 顶峰停顿 |
| 10 | 站姿单腿提踵 | 2 × 10/侧 | 自重 | 45s | ★新增 | 左侧先做 |
| 11 | 坐姿4字臀肌拉伸 | 1 × 30s/侧 | — | — | 已有 | 收尾 |
| 12 | 婴儿式 | 1 × 45s | — | — | 已有 | 收尾 |

### 10.5 单循环训练量（A+B+C+D 各一次，不等于每周）

> 只统计 `phase='main'`。热身、拉伸、激活动作不计入。
> 直接组 = 该肌群为 `primary`；间接组 = 复合动作中该肌群为 `secondary`。同一组不重复计入两个口径。

| 肌群 | 直接组数 | 间接组数 | 说明 |
|---|---:|---:|---|
| 胸部 | 6 | 0 | A 3 + C 3，维持 |
| 背部（背阔为主） | 14 | 8 | A 7 + C 7；面拉 3、鸟狗 3、农夫走 2 计间接 |
| 肩部前束 | 6 | 6 | A 3 + C 3；地板卧推 3+3 间接 |
| 肩部中束 | 3 | 3 | C 侧平举 3；双哑铃肩推 3 间接 |
| 肩部后束 | 3 | 10 | C 面拉 3；划船 4+3+3 间接 |
| 肱二头肌 | 6 | 10 | A 3 + C 3；划船 4+3+3 间接 |
| 肱三头肌 | **4** | **12** | A 弹力带三头下压 2 + C 弹力带三头下压 2；地板卧推 A 3 + C 3（每套 3 组计间接）+ 肩推 A 3 + C 3（每套 3 组计间接） |
| 核心稳定 | **16** | **13** | 专门动作 16；其他复合动作间接 13 |
| 腹部直接 | **2** | 0 | 反向卷腹 2 |
| 臀大肌 | 8 | 5 | 臀桥 3 + 髋铰链 3 + 分腿蹲 2；鸟狗 3、髋外展 2 间接 |
| 臀中肌 | 2 | 5 | 髋外展 2；分腿蹲 2 + 单腿髋铰链 3 间接 |
| 大腿前侧 | 2 | 0 | 分腿蹲 2，控制下肢量 |
| 大腿后侧 | **3** | **5** | 髋铰链 3；臀桥 3 + 分腿蹲 2 间接 |
| 小腿 | 5 | 0 | 双腿 3 + 单腿 2 |
| 全身及辅助 | 2 | 0 | 农夫走 2（交叉分类，不参与合计，避免与核心稳定重复） |

**核心口径（直接 / 间接分离，先修正）：**

| 口径 | 组数 | 构成 |
|---|---:|---|
| 腹部直接 | 2 | 反向卷腹 2 |
| 核心稳定（专门动作，直接） | 16 | 死虫 3、帕洛夫 3、前臂平板 3、鸟狗 3、侧平板 2、农夫走 2 |
| **专项核心合计** | **18** | **腹部直接 2 + 核心稳定 16**（专项核心评估口径；含稳定动作直接训练，不含间接） |
| 核心间接（其他复合动作间接刺激） | 13 | 站姿单臂肩推 3、墙辅助单腿髋铰链 3、单哑铃臀桥 3、椅子支撑分腿蹲 2、站姿单腿提踵 2 |
| **核心稳定及间接合计** | **29** | **核心稳定 16 + 核心间接 13**（核心跨动作合计；不与“18”互加） |

说明：

- 只计 `phase='main'`；热身、收尾不计。
- **直接训练 vs 间接刺激**：腹部直接（2）与核心稳定专门动作（16）按直接口径；其余核心相关组（13）按间接口径，分别列出，不互混。
- 18 组是**专项核心动作合计**（腹部直接 2 + 核心稳定 16），但不能整体称为“腹肌训练”；腹部直接只有 2 组，死虫/平板/帕洛夫/侧平板归入核心稳定，不重复算腹部直接。
- 29 是**核心稳定及间接合计**（稳定 16 + 间接 13），用于评估核心整体刺激；不要再把它当成“腹肌训练”或“专项核心”另算一遍。
- 18 组与 29 组是两个不同口径，勿再从 18 推导 29，或从 29 减“18”得出间接；间接只能由“稳定 + 间接”相加。
- 农夫走归入核心稳定，不等于腹肌直接训练；也不计入腹部直接。
- 徒手臀桥是热身，不计入臀大肌有效组数。
- 仰卧屈膝抬脚不在当前模板，不计入单循环。

**与现状对比：**

| 肌群 | 旧（4×同一套） | 新（单循环） | 变化 |
|---|---:|---:|---|
| 核心 | ≈28 | ≈18 | ↓ 约 36%，执行 4 周后评估，不继续猛砍 |
| 背部 | ≈24 | ≈17 | ↓，但每次质量提高 |
| 胸部 | ≈12 | ≈6 | ↓，符合“维持” |
| 肩前束 | ≈12 | ≈6 | ↓ |
| 肩中束 | ≈8 | ≈3 | ↓，但 C 每次 3 组 |
| 肩后束 | ≈8 | ≈3 | ↓，面拉 3 组 |
| 肱二头 | ≈12 | ≈6 | ↓ |
| 臀大肌 | ≈0 | ≈8 | ↑ 明显补齐 |
| 臀中肌 | ≈0 | ≈2 直接 + 5 间接 | ↑ |
| 小腿 | 0 | 5 | ↑ |

**上半身维持选项（2026-11-12 已确认启用）：**

- A 的单臂划船 3 → 4 组；
- C 的直臂下压 3 → 4 组、面拉 2 → 3 组；
- 单次约增加 4–6 分钟，A 约 44–48 分钟，C 约 52–56 分钟（含新增 2 组弹力带三头下压）。
- 已计入上方 10.5 表的组数。
- 执行 4 周后，再根据实际时长和难度决定是否保留。

### 10.6 设计稿“新增”项核对（17 项中 13 项历史已存在，仅 4 项真正全新）

> 下表保留设计稿原“新增”清单，用于核对；不再把这 17 项都称为“新增动作”。
> 真正全新：`弹力带三头下压`、`弹力带面拉`、`弹力带髋外展`、`侧平板支撑`。

| 动作 | 用途 | 替代方案（不新增时） |
|---|---|---|
| 椅子支撑单臂哑铃划船 | 单侧背部 | 保留双臂弹力带划船，加 1 组 |
| 弹力带三头下压 | 肱三头 | 无（已确认采用） |
| 徒手臀桥 | 臀部激活 | 可删，直接单哑铃臀桥 |
| 单哑铃臀桥 | 臀大肌 | 负重髋铰链（但已有墙辅助） |
| 反向卷腹 | 核心 | 死虫 +1 组 |
| 髋屈肌拉伸 | 收尾 | 坐姿4字拉伸 |
| 站姿单臂肩推 | 单侧肩推 | 双哑铃肩推（A 已有） |
| 弹力带单臂划船 | 单侧背 | 双臂弹力带划船 +1 组 |
| 弹力带面拉 | 肩后束/上背 | 可删，侧平举 +1 组 |
| 单臂哑铃弯举 | 单侧肱二头 | 双哑铃弯举 |
| 椅子支撑分腿蹲 | 单腿臀腿 | 可删，改墙辅助单腿髋铰链 +1 组 |
| 农夫走 | 核心/握力 | 可删 |
| 鸟狗式 | 核心稳定 | 死虫 +1 组 |
| 侧平板支撑 | 核心抗侧屈 | 可删，平板 +1 组 |
| 弹力带髋外展 | 臀中肌 | **无同等替代；这是补臀中肌的关键动作** |
| 双腿哑铃提踵 | 小腿 | 可删 |
| 站姿单腿提踵 | 小腿/平衡 | 可删 |

> 侧平板只归入“核心稳定”，不归入臀中肌。臀中肌只由髋外展直接训练，分腿蹲/单腿髋铰链算间接。

---

## 11. 统计口径：单循环训练量 vs 自然周训练量

### 11.1 口径一：单循环训练量

```text
范围 = A + B + C + D 各一次
用途 = 判断一套循环的肌群分配是否合理
标签 = “单循环训练量（4 次一套，不等于每周）”
```

- 直接组：模板中该肌群为 `primary` 的组数。
- 间接组：`secondary` 的组数。
- 核心必须拆成“核心稳定”和“腹部直接”两个口径，不能合并成一个“核心/腹肌”数字。
- 农夫走只计核心稳定，不计腹部直接。
- 不按自然周折算，不乘以“每周几次”。
- 用户调整模板后，单循环统计随之变化，但历史训练量不回溯改变。

### 11.2 口径二：自然周训练量

```text
范围 = 按 workouts.workout_date 所属自然周（周一至周日）
用途 = 看这一周实际完成了什么
标签 = “本周实际训练量（按完成日期统计）”
```

规则：

- 只统计该周真实存在的 workouts。
- 显示该周完成次数、循环代码（如 A、B、D）。
- 组数取 `coalesce(actual_sets, planned_sets, 0)`，且只统计 `completed=true`。
- 某周只练了 A+B，就只显示 A+B，不假设 C/D 会发生，不外推成“每周训练量”。
- 历史记录缺 `actual_sets` 时，用 `planned_sets` 快照，并标注“计划值”。
- 肌群通过 `exercise_id_snapshot` 映射；未映射的归入“未分类”，不猜测。

### 11.3 页面展示

统计页顶部两个切换：

```text
[ 单循环训练量 ]  [ 本周实际训练量 ]
```

默认显示“本周实际训练量”，并明确写出统计区间，例如：

```text
2026-11-09 ～ 2026-11-15
本周完成 2 次：A、B
```

### 11.4 禁止事项

- 不得把 A+B+C+D 的总组数标成“每周训练量”。
- 不得用“每周 4 次”作为默认假设。
- 不得因为某周只练 2 次就把缺失的 C/D 补进统计。
- 不得用理论估算替代 `actual_duration_minutes` 的实测校准。

---

## 12. 页面导航与首页训练标题

### 12.1 底部导航

```text
🏠 首页   🔁 训练计划   📚 动作库   📊 统计   ⋯ 更多
```

| 页面 | 职责 |
|---|---|
| `index.html` | 当前 pending 计划、已完成次数、预计编号、开始/完成训练 |
| `cycle-plan.html` | A/B/C/D 模板编辑、启用/停用、排序；无星期字段 |
| `exercises.html` | 动作库、别名、肌群、设备、归档 |
| `analysis.html` | 单循环训练量 + 自然周训练量 + 趋势 |
| `more.html` | 历史、身体数据、设置、备份、恢复 |

### 12.2 首页标题状态机

```text
读取：
  completed_count = workouts 数量（不是 MAX）
  last_number     = counter.last_number
  pending         = status='pending' 的计划
  next_cycle      = pending 的循环 或 按第 1.2 节计算

渲染：
  顶部：
    已完成 {completed_count} 次训练
  主标题：
    若 pending 存在：
      下一次训练 · 循环 {code} {name}
      副标题：预计第 {last_number + 1} 次（完成保存时分配）
    若 pending 不存在但有模板：
      下一次训练 · 循环 {next_code} {name}
      副标题：预计第 {last_number + 1} 次（完成保存时分配）
    若没有模板：
      等待训练计划
  完成后：
    第 {rpc.workout_number} 次训练 · 循环 {rpc.cycle_code} {rpc.cycle_name}
```

### 12.3 历史列表/详情

```text
标题：第 {workout_number} 次训练 · 循环 {cycle_code_snapshot}
副标题：{cycle_name_snapshot} · {workout_date}
动作区：读取 workout_exercise_records 快照列
```

- 历史编号来自 `workouts.workout_number`，不重新计算。
- 历史循环来自 `cycle_code_snapshot`；旧记录为 NULL 时显示“历史未分类”，不猜。
- 弹力带动作显示阻力快照、计划阻力和实际阻力；旧记录实际值为 NULL 时标注“未记录”。
- 删除某次训练后，列表允许出现编号空缺。

---

## 13. 逐项测试用例

### 13.1 编号与并发

| # | 场景 | 步骤 | 预期 |
|---|---|---|---|
| T01 | 删除最高编号 | 完成第 32 次 → 删除第 32 次 → 完成下一次 | 编号 33；counter=33；历史 31,33 |
| T02 | 重复点击完成 | 同一 submission_key 连点 3 次 | 只生成 1 条 workout；第 2/3 次 `replayed=true`；编号只加 1 |
| T03 | 两个标签页同时完成 | 同一 plan，不同 submission_key 并发 | 一个成功；另一个 `ALREADY_COMPLETED`；编号只加 1 |
| T04 | RPC 中途失败 | 提交一个不属于该计划的 plan_exercise_id | 报 `INVALID_PLAN_EXERCISE`；counter 不变；无 workout/records；plan 仍 pending |
| T05 | 编号不因预览变化 | 打开首页、刷新 5 次、替换 pending 计划 | counter 不变；预计编号仍为 last+1 |
| T06 | 计数器未初始化 | 删除 counter 行后完成 | 报 `COUNTER_NOT_INITIALIZED`；整体回滚 |
| T07 | 历史编号不可改 | 直接 PATCH workouts.workout_number | 触发器拒绝 |

### 13.2 循环与模板

| # | 场景 | 预期 |
|---|---|---|
| T08 | A→B→C→D 回绕 | 完成 D 后下一次为 A |
| T09 | 任意间隔天数 | 隔 1 天或 10 天，循环顺序不变 |
| T10 | 修改模板 | 已生成 pending 计划内容不变；历史不变 |
| T11 | 停用模板 | 下一次跳过停用模板；已生成计划仍可完成 |
| T12 | 删除历史后循环 | 删除第 32 次（B），下一次仍为 C（依据 completed 计划，不倒退） |
| T13 | 全站无星期 | 页面/模板/SQL 无 weekday、固定训练日字段 |

### 13.3 历史独立性与快照

| # | 场景 | 预期 |
|---|---|---|
| T14 | 动作库改名 | 历史仍显示旧名 |
| T15 | 动作归档 | 历史仍可显示；模板不再新增 |
| T16 | 弹力带从 15 改 20 | 历史仍显示 15 磅；新计划计划值为 20；实际阻力单独保存且历史为 NULL |
| T17 | 删除有历史的计划 | FK/触发器拒绝 |
| T18 | 历史 actual_* | 31 次训练对应的历史动作记录全部 NULL；无一条 plan_default |
| T19 | 逐列补齐 | 只补 NULL 快照；已有值不变 |
| T20 | 历史展示 | 不 JOIN 动作库/设备库也能完整显示 |

### 13.4 SQL 幂等

| # | 场景 | 预期 |
|---|---|---|
| T21 | 整段连跑两次 | 第二次无报错；对象数量一致 |
| T22 | 部分执行：删一列再跑 | 自动补列 |
| T23 | 部分执行：删一约束再跑 | 自动补约束 |
| T24 | 部分执行：删一索引再跑 | 自动补索引 |
| T25 | 同名索引在别的表 | 不会误跳过目标表索引 |
| T26 | 外键删除规则错误 | 只替换目标列映射的外键，不误删其他外键 |

### 13.5 保存与难度

| # | 场景 | 预期 |
|---|---|---|
| T27 | 不点难度直接完成 | 保存成功；difficulty=NULL；actual_source=plan_default |
| T28 | 展开改一个动作 | 只有该动作 user_confirmed；其他 plan_default |
| T29 | 标记未完成 | completed=false；actual_*=NULL；source=NULL；不计入进阶 |
| T30 | 实际时长取消 | 不保存，不消耗编号 |
| T31 | 计划无动作 | 报 `PLAN_EMPTY`，不消耗编号 |

### 13.6 备份与恢复

| # | 场景 | 预期 |
|---|---|---|
| T32 | v2 合并恢复重复导入 | 不产生重复；计数不变 |
| T33 | 合并缺父行 | 跳过子行并报告，不插入孤儿 |
| T34 | 合并后计数器 | 取本地/备份/max 的最大值 |
| T35 | v1 导入 | 7 表成功；actual_source 仍 NULL；计数器修正 |
| T36 | 完整恢复入口 | 网页不可用；仅离线脚本 |
| T37 | 离线恢复失败 | 整体 ROLLBACK；原数据不变 |
| T38 | 恢复后序列 | 每张表 nextval > max(id) |

### 13.7 统计

| # | 场景 | 预期 |
|---|---|---|
| T39 | 单循环统计 | 标注“4 次一套，不等于每周”；直接/间接分开；腹部直接 2、核心稳定 16、核心间接 13 |
| T40 | 自然周只有 A+B | 只统计 A+B，不补 C/D，不外推 |
| T41 | 未完成动作 | 不计入自然周组数 |
| T42 | 未映射动作 | 归入“未分类”，不猜测肌群 |

### 13.8 设备

| # | 场景 | 预期 |
|---|---|---|
| T43 | 设备库 | 10/15/20 三条弹力带，默认 15，三条都不删除 |
| T44 | 计划动作 | 记录计划阻力 15 磅/6.80kg，不只写“弹力带”；实际阻力分开 |
| T45 | 45 磅审计 | 历史/模板/提示词均无 45 磅 |
| T46 | 单动作换 10 或 20 磅 | 只改该计划动作，模板默认与其他动作不变，历史快照不变 |

### 13.9 动作库、命名与训练量

| # | 场景 | 预期 |
|---|---|---|
| T47 | C 计划三头下压 | C 第 10 行为 `弹力带三头下压 2×10–12`；地板卧推顺延；时长为 52–56 分钟 |
| T48 | 单动作阻力独立 | 面拉/髋外展可单独 10 磅，其他动作保持 15 磅，重新生成仍默认 15 |
| T49 | 计划/实际阻力分离 | 计划 15、实际 20 可同时存在；历史 `actual_resistance_*` 保持 NULL |
| T50 | 动作库分类 | 38 个标准动作；模板使用 34；历史仅保留 4；真正新增 4；历史独有动作不删除 |
| T51 | 命名与别名 | 三头标准名 `弹力带三头下压`；15 条别名；44 个历史名称全映射；历史原名称不改写 |
| T52 | 单循环训练量 | 三头 4 直接/12 间接；腹部直接 2、核心稳定 16/13；其他肌群符合 10.5 表 |
| T53 | 迁移种子自检 | 38 动作 / 15 别名 / 78 肌群映射；未映射历史名称 0；历史实际阻力全 NULL |

---

## 14. 分阶段实施与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| 1 | SQL 迁移（跑两次）、动作库/别名/肌群、15 条别名映射、设备库 10/15/20 | 幂等通过；历史 actual_source 全 NULL；快照逐列补齐；45 磅 0 处 |
| 2 | 计数器、pending 唯一、completed 保护触发器、RPC | 删除最高编号不复用；重复点击只 1 条；失败不消耗编号 |
| 3 | 首页编号/循环展示、模板页、pending 生成 | 标题显示“预计第 N 次”；A→B→C→D 回绕；刷新不重复生成 |
| 4 | 完成训练默认继承、难度非必填、展开修改 | 默认 plan_default；改过 user_confirmed；未完成 actual NULL |
| 5 | 历史详情快照展示、版本查看、模板修改隔离 | 改库/改模板/归档后历史不变；删有历史计划被拒 |
| 6 | AI 分析/预览/应用范围 | 默认仅当前 pending；同步模板需勾选；重复导入提示无变化 |
| 7 | 统计两套口径、备份 v2 合并恢复、v1 兼容 | 单循环/自然周分开；合并只增不改；恢复校验通过 |
| 8 | 全量测试 T01–T53 | 全部通过 |

---

## 15. 已确认事项与下一步

2026-11-12 确认结果：

1. **动作库 38 个标准动作全部保留**：当前 A/B/C/D 使用 34 个（30 个历史动作 + 4 个真正新增）；历史存在但当前模板不使用的 4 个（靠墙静蹲、仰卧哑铃臂屈伸、仰卧屈膝抬脚、俯身单臂哑铃划船）也保留且 `is_active=true`。
2. **弹力带命名**：标准名统一“弹力带”前缀；肱三头动作定名 `弹力带三头下压`，`弹力带下压`、`弹力绳下压` 仅作别名。历史原始名称不改写。
3. **启用“上半身维持选项”**：A 单臂划船 4 组、C 直臂下压 4 组、C 面拉 3 组。
4. **肱三头**：A 2 组 + C 2 组 `弹力带三头下压` = 单循环 4 组直接训练；地板卧推 A 3 + C 3 共 6 组计间接（即每套地板卧推 3 组均作为肱三头间接刺激；另有肩推间接 6 组，间接合计单循环 12 组）。
5. **核心口径**：只计 `phase='main'`；腹部直接 2 组 + 核心稳定 16 组 = 专项核心 18 组；另有其他复合动作的核心间接 13 组单独列出；核心稳定及间接合计 29 组。农夫走归核心稳定，不算腹部直接。
6. **弹力带规格**：10/15/20 磅三条全部入库；模板默认 15 磅；每个计划动作可独立选择 10/15/20；面拉、髋外展允许 10 磅；计划值、实际值、历史快照分开保存。
7. **C 计划时间**：增加 2 组三头下压后约 52–56 分钟；不为了强行控制在 45 分钟而删减有效训练。

（2026-11-12 终审修订：核心统计口径按“直接训练 vs 间接刺激”拆分，18 组为专项核心合计、29 组为核心稳定及间接合计，不再混算。）

单循环训练量（直接/间接，只计 main）：

- 背 14/8、胸 6/0、肩前 6/6、肩中 3/3、肩后 3/10、二头 6/10、三头 4/12；
- 腹部直接 2/0、核心稳定 16/13、臀大 8/5、臀中 2/5、腿前 2/0、腿后 3/5、小腿 5/0。

下一步（阶段 1）：

1. 提交完整迁移 SQL 与动作库种子清单（38 个标准动作、15 条别名 = 13 历史 + 2 命名、78 条肌群映射、10/15/20 设备）给你审阅。
2. 你在 Supabase SQL Editor 执行迁移，连续执行两次验证幂等。
3. 运行迁移后自检 SQL，确认 44 个历史名称全部映射、历史 `actual_source` 全 NULL、快照逐列补齐、计数器正确。
4. 再进入 RPC 与前端改造。

> 本文件与配套 SQL 仍是草案；在阶段 1 审阅通过前不执行任何写操作。



---

## 16. 本轮修订报告（终审稿）

> 本章为第四版修订报告终审稿；`docs/exercise-library-v4.md` 为动作库种子清单来源。
> 本轮未执行 SQL、未访问数据库、未修改项目代码。

### 16.1 本轮修订结论（2026-11-12 终审）

1. **动作库与命名**：38 个标准动作全部保留；标准名统一“弹力带”前缀；`弹力带三头下压`、`弹力带面拉`、`弹力带髋外展` 为标准名，`弹力带下压`、`弹力绳下压` 为 `弹力带三头下压` 的命名别名；其他历史“弹力绳”写法继续作为别名保留。历史原始名称不改写。
2. **覆盖校验**：44 个历史原始名称全部映射；38 个标准动作；15 条别名（13 历史 + 2 命名）；78 条肌群映射（含“统计口径”调整）。
3. **训练量**：只计 `phase='main'`；热身/收尾不计。弹力带三头下压单循环 4 组直接（A 2 + C 2）；地板卧推（A 3 + C 3）计间接；间接合计 12 组。核心按“直接（腹部直接 2 + 核心稳定 16）”与“间接（核心间接 13）”分离；专项核心合计 18 组，核心稳定及间接合计 29 组。
4. **时间估算**：C 计划含 2 组 `弹力带三头下压`，单次约 52–56 分钟；未为了控制在 45 分钟而删减有效训练。
5. **设备**：`user_equipment` 含 `弹力带 10磅 / 15磅 / 20磅` 三条 + `哑铃 5kg`（`weight_kg = 5.00`）；默认 15 磅；每计划动作可独立选 10/15/20；面拉、髋外展允许 10 磅；计划值/实际值/历史快照分开保存。
6. **分类**：当前 A/B/C/D 使用 34；历史仅保留 4；真正新增 4；动作库合计 38。

### 16.2 完整动作库种子清单（38 个标准动作）

> 器械文本与“模板”列与 `docs/exercise-library-v4.md` 第 4 节一致。

| # | 标准名称 | 原始名称 / 别名 | 肌群 | 类型 | 器械 | 模板 | 新增 |
|---|---:|---:|---:|---:|---|---|
| 1 | 猫牛式 | 猫牛式 | 主：全身及辅助动作 | 热身 | 自重 | A/B/C/D（热身） | 否 |
| 2 | 肩部动态活动 | 肩部动态活动；别名：肩关节动态活动 | 次：肩部前束、肩部中束、肩部后束 | 热身 | 自重 | A/C（热身） | 否 |
| 3 | 仰卧肩臂滑动 | 仰卧肩臂滑动 | 次：肩部前束、背部 | 热身 | 自重 | A/C（热身） | 否 |
| 4 | 髋部动态活动 | 髋部动态活动 | 次：臀大肌、大腿后侧、核心稳定 | 热身 | 自重 | B/D（热身） | 否 |
| 5 | 徒手臀桥 | 徒手臀桥 | 主：臀大肌；次：核心稳定 | 热身 | 自重 | B/D（热身） | 否 |
| 6 | 门框胸肩拉伸 | 门框胸肩拉伸 | 次：胸部、肩部前束 | 拉伸 | 自重（门框） | A/C（收尾） | 否 |
| 7 | 髋屈肌拉伸 | 髋屈肌拉伸 | 次：大腿前侧 | 拉伸 | 自重 | B（收尾） | 否 |
| 8 | 婴儿式 | 婴儿式；别名：儿童式 | 次：背部、全身及辅助动作 | 拉伸 | 自重 | C/D（收尾） | 否 |
| 9 | 坐姿4字臀肌拉伸 | 坐姿4字臀肌拉伸；别名：坐姿4字臀拉伸、坐姿4字臀部拉伸 | 次：臀大肌、臀中肌 | 拉伸 | 自重 | B/D（收尾） | 否 |
| 10 | 哑铃地板卧推 | 哑铃地板卧推 | 主：胸部；次：肱三头肌、肩部前束 | 力量 | 哑铃 5kg ×2 | A/C | 否 |
| 11 | 双哑铃肩推 | 双哑铃肩推；别名：双手哑铃肩推 | 主：肩部前束；次：肱三头肌、肩部中束 | 力量 | 哑铃 5kg ×2 | A | 否 |
| 12 | 站姿单臂肩推 | 站姿单臂肩推 | 主：肩部前束；次：肱三头肌、核心稳定 | 力量 | 哑铃 5kg | C | 否 |
| 13 | 椅子支撑单臂哑铃划船 | 椅子支撑单臂哑铃划船 | 主：背部；次：肱二头肌、肩部后束 | 力量 | 哑铃 5kg + 椅子 | A | 否 |
| 14 | 俯身单臂哑铃划船 | 俯身单臂哑铃划船 | 主：背部；次：肱二头肌 | 力量 | 哑铃 5kg | — | 否 |
| 15 | 双臂弹力带划船 | 双臂弹力带划船；别名：双臂弹力绳划船 | 主：背部；次：肱二头肌、肩部后束 | 力量 | 弹力带（默认 15磅，可 10/20） | A | 否 |
| 16 | 弹力带单臂划船 | 弹力带单臂划船；别名：弹力绳单臂划船 | 主：背部；次：肱二头肌、肩部后束 | 力量 | 弹力带（默认 15磅，可 10/20） | C | 否（历史别名形式） |
| 17 | 弹力带直臂下压 | 弹力带直臂下压；别名：弹力绳直臂下压、弹力带直臂下拉 | 主：背部 | 力量 | 弹力带（默认 15磅，可 10/20） | C | 否 |
| 18 | 单臂弹力带侧平举 | 单臂弹力带侧平举；别名：单臂弹力绳侧平举、单侧弹力绳侧平举 | 主：肩部中束 | 力量 | 弹力带（默认 15磅，可 10/20） | C | 否 |
| 19 | 弹力带面拉 | 弹力带面拉（历史 0 次；设计稿同名） | 主：肩部后束；次：背部 | 力量 | 弹力带（默认 15磅，可 10/20） | C | **是（全新）** |
| 20 | 双哑铃弯举 | 双哑铃弯举；别名：双手哑铃弯举 | 主：肱二头肌 | 力量 | 哑铃 5kg ×2 | A | 否 |
| 21 | 单臂哑铃弯举 | 单臂哑铃弯举 | 主：肱二头肌 | 力量 | 哑铃 5kg | C | 否 |
| 22 | 弹力带三头下压 | 弹力带三头下压；别名：弹力带下压（设计稿名）、弹力绳下压 | 主：肱三头肌 | 力量 | 弹力带（默认 15磅，可 10/20） | A/C | **是（全新）** |
| 23 | 仰卧哑铃臂屈伸 | 仰卧哑铃臂屈伸 | 主：肱三头肌 | 力量 | 哑铃 5kg | — | 否 |
| 24 | 椅子支撑分腿蹲 | 椅子支撑分腿蹲 | 主：大腿前侧、臀大肌；次：臀中肌、大腿后侧、核心稳定 | 力量 | 自重 → 哑铃 5kg | D | 否 |
| 25 | 墙辅助单腿髋铰链 | 墙辅助单腿髋铰链 | 主：臀大肌、大腿后侧；次：臀中肌、核心稳定 | 力量 | 自重（墙） | B | 否 |
| 26 | 单哑铃臀桥 | 单哑铃臀桥 | 主：臀大肌；次：大腿后侧、核心稳定 | 力量 | 哑铃 5kg | B | 否 |
| 27 | 弹力带髋外展 | 弹力带髋外展（历史 0 次；设计稿同名） | 主：臀中肌；次：臀大肌 | 力量 | 弹力带（默认 15磅，可 10/20） | D | **是（全新）** |
| 28 | 靠墙静蹲 | 靠墙静蹲 | 主：大腿前侧；次：臀大肌、核心稳定 | 力量 | 自重（墙） | — | 否 |
| 29 | 双腿哑铃提踵 | 双腿哑铃提踵 | 主：小腿 | 力量 | 哑铃 5kg | D | 否 |
| 30 | 站姿单腿提踵 | 站姿单腿提踵 | 主：小腿；次：核心稳定 | 力量 | 自重 | D | 否 |
| 31 | 农夫走 | 农夫走 | 主：核心稳定、全身及辅助动作；次：背部 | 力量 | 哑铃 5kg ×2 | D | 否 |
| 32 | 死虫 | 死虫；别名：死虫式 | 主：核心稳定 | 核心 | 自重 | B | 否 |
| 33 | 鸟狗式 | 鸟狗式 | 主：核心稳定；次：臀大肌、背部 | 核心 | 自重 | D | 否 |
| 34 | 反向卷腹 | 反向卷腹 | 主：腹部 | 核心 | 自重 | B | 否 |
| 35 | 仰卧屈膝抬脚 | 仰卧屈膝抬脚 | 主：腹部 | 核心 | 自重 | — | 否 |
| 36 | 前臂平板支撑 | 前臂平板支撑 | 主：核心稳定 | 核心 | 自重 | B | 否 |
| 37 | 帕洛夫抗旋转 | 帕洛夫抗旋转 | 主：核心稳定 | 核心 | 弹力带（默认 15磅，可 10/20） | B | 否 |
| 38 | 侧平板支撑 | 侧平板支撑 | 主：核心稳定 | 核心 | 自重 | D | **是（全新）** |

### 16.3 关键数字终审

- 历史原始名称：44；映射：全部；历史标准动作：34；真正全新：4；动作库合计：**38**。
- 别名：15 条（13 历史 + 2 命名）；肌群映射：78 条。
- 弹力带三头下压：单循环直接 4 组（A 2 + C 2）；间接（地板卧推 A/C 3+3、肩推 A/C 3+3）12 组。
- 核心：腹部直接 2；核心稳定 16；核心间接 13；专项核心合计 18；核心稳定及间接合计 29。
- C 计划时间：52–56 分钟（含新增 2 组三头下压）。

### 16.4 未执行与下一步

- 本章、配套 SQL/测试文档均为草案；**未执行 SQL、未读写数据库**。
- 阶段 1 下一步：在 Supabase SQL Editor 连续执行 `docs/sql-v4-migration.sql` 两次；运行自检；进入 RPC/前端改造。

