# 第四版测试用例（设计稿）

> 未执行。用于阶段 1–8 验收。
> 约定：所有“完成训练”均指调用 `complete_workout` RPC，不再走多次 REST 写入。

---

## A. 编号与事务

### T01 删除最高编号后不复用

**步骤**

1. 完成第 32 次，确认 `workouts.workout_number = 32`，`counter.last_number = 32`。
2. 删除第 32 次 workout。
3. 生成下一次 pending 计划并完成。

**预期**

- 删除后 `counter.last_number` 仍为 32。
- 下一次返回 `workout_number = 33`。
- 历史编号出现 31 → 33 的空缺。
- 不出现第二条 32。

**校验 SQL**

```sql
select last_number from workout_number_counter where id=1; -- 33
select workout_number from workouts order by workout_number; -- ... 31, 33
```

---

### T02 重复点击完成（同一 submission_key）

**步骤**

1. 前端生成一个 `submission_key`。
2. 连续点击“完成训练”3 次（网络重试使用同一 key）。

**预期**

- 只生成 1 条 workout。
- 第 2/3 次返回 `replayed=true`，编号与第 1 次相同。
- `counter` 只加 1。

---

### T03 两个标签页同时完成（不同 key）

**步骤**

1. 两个标签页同时打开同一 pending 计划。
2. 各自生成不同 `submission_key`，同时提交。

**预期**

- 一个成功，编号 +1。
- 另一个返回 `ALREADY_COMPLETED`。
- 不产生第二条 workout，不产生第二个编号。

---

### T04 RPC 中途失败不消耗编号

**步骤**

1. 记录当前 `counter.last_number`。
2. 提交一个 `plan_exercise_id` 不属于该计划的条目。
3. 再提交一个 `actual_duration_minutes = 0` 的请求。

**预期**

- 返回 `INVALID_PLAN_EXERCISE` / `INVALID_DURATION`。
- `counter.last_number` 不变。
- 无 workout、无 records。
- 计划仍为 `pending`。

**校验 SQL**

```sql
select last_number from workout_number_counter where id=1;
select count(*) from workouts where training_plan_id = <plan_id>; -- 0
select status from training_plans where id = <plan_id>; -- pending
```

---

### T05 纯预览/刷新不消耗编号

**步骤**

1. 连续刷新首页 5 次。
2. 多次打开训练计划页。
3. 替换 pending 计划 2 次。

**预期**

- `counter.last_number` 不变。
- 首页始终显示“预计第 last+1 次”。
- 不产生 workout。
- 替换 pending 计划后，旧计划变为 `archived`，任何时刻仍只有 1 条 `pending`。
- 旧计划的动作与历史不被删除。

---

### T06 编号不可修改

**步骤**

尝试直接更新 `workouts.workout_number`。

**预期**

- 触发器报 `WORKOUT_NUMBER_IMMUTABLE`。
- 编号不变。

---

### T07 已完成计划不可删除/回退

**步骤**

1. 尝试 `DELETE training_plans` 删除 completed 计划。
2. 尝试 `UPDATE status='pending'`。

**预期**

- DELETE 报 `COMPLETED_PLAN_PROTECTED`。
- UPDATE 报 `COMPLETED_PLAN_STATUS_IMMUTABLE`。

---

## B. 循环与模板

### T08 A→B→C→D 回绕

**步骤**

依次完成 A、B、C、D，再生成下一次。

**预期**

- 下一次为 A。
- 编号连续递增，不受循环回绕影响。

---

### T09 任意间隔天数

**步骤**

A 完成后隔 1 天练 B；B 完成后隔 10 天练 C。

**预期**

- 循环顺序仍为 A→B→C。
- 不读取星期几，不要求固定训练日。

---

### T10 修改模板不影响已生成计划

**步骤**

1. 生成 pending 计划（循环 B）。
2. 修改模板 B：改动作、组数、重量、休息。
3. 查看 pending 计划与历史。

**预期**

- 已生成 pending 计划内容不变。
- 历史记录不变。
- 下一次新建计划才使用新模板。

---

### T11 停用模板

**步骤**

停用模板 C，生成下一次计划。

**预期**

- 跳过 C，直接 D。
- 已生成的 C 计划仍可完成。

---

### T12 删除历史后循环不倒退

**步骤**

1. 完成第 32 次（循环 B）。
2. 删除第 32 次 workout。
3. 生成下一次计划。

**预期**

- 下一次为循环 C，不是重新 B。
- 编号为 33。

> 依据：循环推进读取最近一个 completed 计划，不读取被删除的 workout。

---

### T13 无星期残留

**步骤**

全局搜索 `weekday`、`星期一`、`周一`、`固定训练日`、`weekly_schedule`。

**预期**

- 页面、SQL、模板均无星期字段/逻辑。
- 统计只按真实日期分组，不安排训练日。

---

## C. 历史独立性与快照

### T14 动作库改名

**步骤**

把标准动作“死虫”改名为“死虫（新版）”，查看历史。

**预期**

- 历史 `exercise_name_snapshot` 仍为原始名称 `死虫式` 或 `死虫`，不因动作库改名而变化。
- 历史详情不 JOIN 动作库。
- 新计划使用新标准名称。
- 原别名 `死虫式` 仍可映射到该动作。

---

### T15 动作归档

**步骤**

把某动作 `is_active=false`，查看历史与模板。

**预期**

- 历史正常显示。
- 模板不再新增该动作。
- 已有计划仍可完成。

---

### T16 弹力带阻力变化与计划/实际分离

**步骤**

1. 历史记录使用 15 磅。
2. 把某个新计划动作改为 20 磅，生成并完成一次。
3. 完成时不手工修改实际阻力。

**预期**

- 历史仍显示 `resistance_lb_snapshot = 15` / `6.80kg`。
- 新记录 `resistance_lb_snapshot = 20` / `9.07kg`。
- 新记录 `planned_resistance_lb = 20`；`actual_resistance_lb` 保持 NULL。
- 历史 `actual_resistance_*` 也保持 NULL。
- 两记录互不影响。

---

### T17 删除有历史的计划被拒绝

**步骤**

对有 `workout_exercise_records` 的 `training_plan_exercises` 尝试删除计划。

**预期**

- 外键 RESTRICT 报错。
- 历史记录不丢失。

---

### T18 旧记录 actual_source 全 NULL

**校验 SQL**

```sql
select count(*) from workout_exercise_records where actual_source is not null;
-- 预期 0
```

**预期**

- 31 次训练对应的历史动作记录 `actual_source` 全部为 NULL。
- 无一条被标记为 `plan_default`。

---

### T19 逐列补齐不覆盖

**步骤**

1. 人为把某条历史记录 `planned_weight_kg` 设为 NULL，其他快照保留。
2. 重跑迁移第 5.8 节。

**预期**

- 只补 `planned_weight_kg`。
- 已有 `exercise_name_snapshot`、`planned_reps` 等不变。
- `actual_*` 仍 NULL。

---

### T20 历史展示不依赖 JOIN

**步骤**

断开动作库/设备库（模拟归档/改名）后打开历史详情。

**预期**

- 动作名、设备、阻力、计划值、实际值全部来自 record 快照。
- 页面不报错、不缺字段。

---

## D. SQL 幂等

### T21 整段连续执行两次

**步骤**

1. 执行 `sql-v4-migration.sql`。
2. 再执行一次。

**预期**

- 第二次无报错。
- 约束/索引/触发器数量一致。
- 数据条数不变。

---

### T22 部分执行：缺列

**步骤**

删除一个新增列（测试库），重跑迁移。

**预期**

- `ADD COLUMN IF NOT EXISTS` 自动补列。
- 不破坏其他列。

---

### T23 部分执行：缺约束

**步骤**

删除 `plans_status_chk`，重跑。

**预期**

- `DO` 块按 `conrelid + conname` 检出并补建。
- 不影响其他表同名约束。

---

### T24 部分执行：缺索引

**步骤**

删除 `idx_pe_plan`，重跑。

**预期**

- 按 `indrelid + relname` 检出并补建。

---

### T25 同名索引在别的表

**步骤**

在测试库另一张表创建同名 `idx_pe_plan`，删除目标表索引，重跑。

**预期**

- 不会因为同名而误跳过目标表。
- 目标表索引被补建。

---

### T26 外键删除规则迁移

**步骤**

把 `werec_plan_exercise_fk` 改成 `ON DELETE CASCADE`，重跑第 7 节。

**预期**

- 只删除 `plan_exercise_id → training_plan_exercises.id` 这一条。
- 重建为 RESTRICT。
- 其他外键（如 `workout_id`）不受影响。

---

## E. 保存、难度、默认继承

### T27 不点难度直接完成

**步骤**

所有动作不点难度，直接完成。

**预期**

- 保存成功。
- `difficulty = NULL`。
- `completed = true`。
- `actual_source = plan_default`。
- `actual_* = planned_*`。

---

### T28 展开修改一个动作

**步骤**

只修改第 3 个动作的实际重量/次数/组数。

**预期**

- 第 3 条 `actual_source = user_confirmed`。
- 其他条 `plan_default`。
- 第 3 条实际值等于用户输入。

---

### T29 标记未完成

**步骤**

把某动作点“未完成”。

**预期**

- `completed=false`。
- `difficulty='incomplete'`。
- `actual_* = NULL`。
- `actual_source = NULL`。
- 不进入 AI 进阶判断。

---

### T30 取消实际时长输入

**步骤**

点击完成，实际时长弹窗点取消。

**预期**

- 不调用 RPC，不保存，不消耗编号。

---

### T31 计划无动作

**步骤**

构造空计划并完成。

**预期**

- 返回 `PLAN_EMPTY`。
- 不消耗编号，不生成 workout。

---

## F. 备份与恢复

### T32 v2 合并恢复重复导入

**步骤**

同一份 v2 备份连续导入两次。

**预期**

- 第二次 `ignore-duplicates` 全部跳过。
- 条数不增加。
- 不覆盖本地修改。

---

### T33 合并恢复缺父行

**步骤**

备份中只包含子表行，缺少父表行。

**预期**

- 预检发现缺依赖。
- 跳过该子行并报告。
- 不插入孤儿外键。

---

### T34 合并后计数器

**步骤**

本地 counter=40，备份 counter=31，备份 workouts 最大=31。

**预期**

- counter 保持 40。
- 不回退。

---

### T35 v1 备份导入

**步骤**

导入旧 7 表 v1 备份。

**预期**

- 7 表成功。
- `actual_source` 保持 NULL。
- 计数器修正为 `max(workout_number)`。
- 快照列按第 6 节补齐。

---

### T36 完整恢复入口

**检查**

打开备份页。

**预期**

- 只有“合并恢复”。
- 没有网页端“清空并完整恢复”按钮。
- 提供离线脚本说明，但不执行。

---

### T37 离线完整恢复失败回滚

**步骤**

在测试库执行离线完整恢复脚本，中途制造唯一键冲突。

**预期**

- 事务 ROLLBACK。
- 原数据完全不变。

---

### T38 恢复后序列

**校验 SQL**

```sql
select nextval(pg_get_serial_sequence('public.workouts','id')) >
       (select max(id) from public.workouts);
```

**预期**

- 每张表都返回 true。
- 新插入不撞主键。

---

## G. 统计

### T39 单循环统计标签与直接/间接拆分

**步骤**

打开统计页，切换“单循环训练量”。

**预期**

- 明确显示“A+B+C+D 各一次，不等于每周”。
- 分别显示直接组和间接组。
- 核心显示为“腹部直接 2 + 核心稳定 16”，另有“核心间接 13”，不合并成一个 18 组“腹肌”数字。
- 农夫走只出现在核心稳定，不出现在腹部直接。
- 肱三头显示直接 4、间接 12（地板卧推 6 + 肩推 6）。

---

### T40 自然周只有 A+B

**步骤**

某一自然周只完成 A、B 两次。

**预期**

- 显示 2 次、循环 A/B。
- 只统计 A+B 的组数。
- 不补 C/D，不外推“每周 4 次”。

---

### T41 未完成动作不计入

**步骤**

某动作标记未完成。

**预期**

- 自然周组数不计该动作。
- 单循环模板统计仍显示计划组数（模板口径），但实际周统计不计。

---

### T42 未映射动作

**步骤**

历史记录 `exercise_id_snapshot` 为空。

**预期**

- 归入“未分类”。
- 不猜测肌群，不静默丢弃。

---

## H. 设备

### T43 设备库三条弹力带

**校验 SQL**

```sql
select name, resistance_lb, resistance_kg
from user_equipment
where category='弹力带'
order by resistance_lb;
```

**预期**

- 10 / 15 / 20 三条全部存在。
- 15 磅为模板默认值。
- 10 磅、20 磅未被删除或停用。

---

### T44 计划动作明确阻力且计划/实际分开

**校验 SQL**

```sql
select exercise_name, equipment, resistance_lb, resistance_kg, equipment_snapshot
from training_plan_exercises
where equipment like '%弹力%';
```

**预期**

- 每条弹力带动作都有 `resistance_lb` 和 `resistance_kg`。
- 不只写“弹力带”，阻力值不为 NULL。
- 计划动作的 `resistance_lb` 可独立为 10 / 15 / 20，不被永久锁定为 15。
- `workout_exercise_records` 中 `planned_resistance_*` 有值，历史 `actual_resistance_*` 为 NULL。

---

### T45 无 45 磅

**校验 SQL**

```sql
select count(*) from training_plan_exercises where equipment like '%45%';
select count(*) from cycle_template_exercises where equipment_snapshot like '%45%';
```

**预期**

- 均为 0。
- 提示词/设置中无 45 磅。

---

### T46 单动作切换 10/20 磅

**步骤**

1. 新生成一个 C 计划，`弹力带面拉` 默认 15 磅。
2. 只把 `弹力带面拉` 改为 10 磅，`弹力带髋外展` 改为 10 磅。
3. 其他弹力带动作保持 15 磅，完成一次。

**预期**

- 只有这两个动作的计划阻力变为 10 磅。
- 其他动作仍为 15 磅，模板默认值不被改写。
- 历史 15 磅记录不变。
- 新记录快照分别为 10 / 15 磅。

---

### T47 C 计划新增三头下压与时间估算

**步骤**

1. 生成新的 C 计划。
2. 查看动作顺序、组数和预计时长。

**预期**

- `弹力带三头下压` 在 C 计划中为 `2 × 10–12`，位于单臂弯举之后、地板卧推之前。
- 地板卧推顺延为下一行，收尾动作顺延为 12/13。
- C 计划预计时长为 52–56 分钟，不为压到 45 分钟而删减动作。
- 单循环直接三头组数 = A 2 + C 2 = 4；地板卧推 A 3 + C 3 = 6 组只计间接。

---

### T48 单动作阻力独立选择

**步骤**

1. 生成包含多个弹力带动作的计划。
2. 仅把面拉或髋外展改为 10 磅，其他动作保持 15 磅。
3. 刷新页面后重新读取计划。

**预期**

- 只有被修改的动作是 10 磅。
- 其他弹力带动作仍为 15 磅。
- 再次生成计划时默认仍为 15 磅，不被上一次修改污染。
- 20 磅也可被任一动作独立选择。

---

### T49 计划阻力与实际阻力分离

**步骤**

1. 计划某动作 15 磅。
2. 完成训练时实际改用 20 磅并确认。
3. 查看历史详情和数据库。

**预期**

- `planned_resistance_lb = 15`。
- `actual_resistance_lb = 20`（仅当用户明确确认实际值）。
- 历史未修改动作的 `actual_resistance_*` 保持 NULL。
- 展示层同时能区分“计划 15 / 实际 20”。

---

### T50 动作库分类数量

**校验 SQL**

```sql
select count(*) from exercises; -- 38
select count(*) from exercises where name in (
  '弹力带三头下压','弹力带面拉','弹力带髋外展','侧平板支撑'
); -- 4 个真正新增
```

**预期**

- 动作库共 38 个标准动作。
- 当前模板使用 34 个。
- 历史存在但当前模板不使用 4 个：靠墙静蹲、仰卧哑铃臂屈伸、仰卧屈膝抬脚、俯身单臂哑铃划船。
- 真正新增 4 个：弹力带三头下压、弹力带面拉、弹力带髋外展、侧平板支撑。
- 4 个历史独有动作 `is_active = true`，未被删除。

---

### T51 动作命名与别名映射

**步骤**

1. 查询 `弹力带三头下压` 的别名。
2. 查询 44 个历史原始名称的 `exercise_id` 回填结果。
3. 查看 `training_plan_exercises.exercise_name`。

**预期**

- `弹力带三头下压` 的别名为 `弹力带下压`、`弹力绳下压`。
- 13 条历史别名全部存在，加上 2 条命名别名共 15 条。
- 44 个历史原始名称全部能映射，`exercise_id is null` 为 0。
- 历史 `exercise_name` 与历史详情显示名称完全未改写。

---

### T52 单循环训练量口径

**校验**

按 A+B+C+D 各一次统计，只计 `phase='main'`。

| 肌群 | 直接组 | 间接组 |
|---|---:|---:|
| 胸部 | 6 | 0 |
| 背部 | 14 | 8 |
| 肩部前束 | 6 | 6 |
| 肩部中束 | 3 | 3 |
| 肩部后束 | 3 | 10 |
| 肱二头肌 | 6 | 10 |
| 肱三头肌 | 4 | 12 |
| 核心稳定 | 16 | 13 |
| 腹部直接 | 2 | 0 |
| 臀大肌 | 8 | 5 |
| 臀中肌 | 2 | 5 |
| 大腿前侧 | 2 | 0 |
| 大腿后侧 | 3 | 5 |
| 小腿 | 5 | 0 |

**预期**

- 热身、拉伸不计入。
- 徒手臀桥不计入臀大肌有效组数。
- 农夫走只计核心稳定，不计腹部直接。
- 腹部直接 2；核心稳定 16；核心间接 13；专项核心合计 18，核心稳定及间接合计 29。
- 同一组不同时计入直接和间接。

---

### T53 迁移种子与自检

**校验 SQL**

```sql
select
  (select count(*) from exercises) as exercises_count,
  (select count(*) from exercise_aliases) as alias_count,
  (select count(*) from exercise_muscle_groups) as muscle_mapping_count;
```

**预期**

- `exercises_count = 38`。
- `alias_count = 15`（13 历史 + 2 命名）。
- `muscle_mapping_count = 78`。
- 迁移自检 10.8 的 `unmapped_historical_names = 0`。
- 迁移自检 10.9 的 `legacy_actual_resistance_not_null = 0`。
- 迁移自检 10.10 返回 10 / 15 / 20 三行。
- 迁移自检 10.11 的 `exercises_without_muscle_mapping = 0`。
- 迁移自检 10.12 的 `classified_actions = 8`。
- 迁移自检 10.13 的 `band_plan_actions_without_resistance = 0`。
