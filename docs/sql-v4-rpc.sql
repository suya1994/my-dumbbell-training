-- ============================================================
-- 哑铃训练应用 · 第四版 RPC（未执行，需人工在 Supabase SQL Editor 运行）
-- 依赖：先执行 docs/sql-v4-migration.sql
--
-- 包含：
--   1. ensure_pending_plan             幂等生成当前 pending 计划
--   2. complete_workout                原子分配编号并保存训练
--   3. apply_pending_plan_content      原子替换 pending 计划（AI / 手动编辑）
--   4. save_cycle_template             原子保存 A/B/C/D 模板（不碰历史）
--   5. merge_workout_number_counter    备份合并后只升不降
--
-- 所有函数均为单一事务：任何异常都会整体回滚。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 内部辅助：动作名 / 设备解析（不写业务表）
-- ------------------------------------------------------------
create or replace function public.v4_resolve_exercise_id(p_name text)
returns bigint
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    (select e.id
       from public.exercises e
      where e.name = btrim(p_name)
      order by e.id
      limit 1),
    (select a.exercise_id
       from public.exercise_aliases a
      where a.alias_normalized = lower(regexp_replace(btrim(p_name), '\s+', '', 'g'))
      order by a.id
      limit 1)
  );
$$;

create or replace function public.v4_resolve_equipment_id(p_equipment text, p_resistance_lb numeric)
returns bigint
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select ue.id
  from public.user_equipment ue
  where ue.is_active = true
    and (
      (p_resistance_lb is not null
        and ue.category = '弹力带'
        and ue.resistance_lb = p_resistance_lb)
      or
      (p_resistance_lb is null
        and p_equipment is not null
        and ue.name = btrim(p_equipment))
    )
  order by ue.id
  limit 1;
$$;


-- ------------------------------------------------------------
-- 1. 幂等生成 pending 计划
--    - 同一时间最多一条 pending（数据库索引兜底）
--    - 不分配实际编号
--    - 生成时复制模板内容快照
-- ------------------------------------------------------------
create or replace function public.ensure_pending_plan(
  p_template_id       bigint  default null,
  p_replace_pending   boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_pending   public.training_plans%rowtype;
  v_template  public.cycle_templates%rowtype;
  v_last_sort integer;
  v_plan_id   bigint;
  v_version   integer;
  v_count     integer;
  v_expected  integer;
  v_replaced  boolean := false;
begin
  -- 串行化并发生成；事务结束自动释放
  perform pg_advisory_xact_lock(20261112);

  select last_number + 1 into v_expected
  from public.workout_number_counter
  where id = 1;

  if v_expected is null then
    return jsonb_build_object('ok', false, 'error', 'COUNTER_NOT_INITIALIZED');
  end if;

  select * into v_pending
  from public.training_plans
  where status = 'pending'
  order by id
  limit 1;

  if found then
    -- 只有显式要求替换、且目标模板不同，才归档旧 pending。
    -- 归档不删除动作、不删除历史，也不改变编号。
    if p_replace_pending
       and p_template_id is not null
       and v_pending.cycle_template_id is distinct from p_template_id then
      update public.training_plans
      set status = 'archived',
          updated_at = now()
      where id = v_pending.id;

      v_replaced := true;
    else
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'replaced', false,
        'plan_id', v_pending.id,
        'cycle_code', v_pending.cycle_code_snapshot,
        'cycle_name', v_pending.cycle_name_snapshot,
        'expected_workout_number', v_expected
      );
    end if;
  end if;

  if p_template_id is not null then
    select * into v_template
    from public.cycle_templates
    where id = p_template_id and is_active = true;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'TEMPLATE_NOT_FOUND');
    end if;
  else
    -- 按“最近一次已完成计划”的循环顺序推进，而不是按已完成计划的最大 sort_order。
    -- 这样手动切换 pending 模板后，下一次顺序仍然正确，也不会跳过循环。
    select ct.sort_order into v_last_sort
    from public.training_plans p
    join public.cycle_templates ct on ct.id = p.cycle_template_id
    where p.status = 'completed'
      and p.workout_number is not null
    order by p.workout_number desc
    limit 1;

    if v_last_sort is not null then
      select * into v_template
      from public.cycle_templates
      where is_active = true
        and sort_order > v_last_sort
      order by sort_order
      limit 1;
    end if;

    if not found then
      select * into v_template
      from public.cycle_templates
      where is_active = true
      order by sort_order
      limit 1;
    end if;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_TEMPLATE');
    end if;
  end if;

  insert into public.training_plans (
    workout_number, plan_date, title, focus, duration_minutes, notes,
    cycle_template_id, cycle_code_snapshot, cycle_name_snapshot,
    source, status
  ) values (
    null, current_date, v_template.name, v_template.focus, v_template.duration_minutes, v_template.notes,
    v_template.id, v_template.code, v_template.name,
    'cycle_template', 'pending'
  )
  returning id into v_plan_id;

  insert into public.training_plan_exercises (
    plan_id, exercise_order, exercise_name, equipment,
    weight_kg, reps, sets, notes,
    exercise_id, phase, duration_seconds, rest_seconds,
    equipment_id, resistance_lb, resistance_kg, equipment_snapshot
  )
  select
    v_plan_id,
    cte.sort_order,
    e.name,
    coalesce(cte.equipment_snapshot, e.equipment_hint, '自重'),
    cte.weight_kg,
    cte.reps,
    cte.sets,
    cte.notes,
    cte.exercise_id,
    cte.phase,
    cte.duration_seconds,
    cte.rest_seconds,
    cte.equipment_id,
    cte.resistance_lb,
    cte.resistance_kg,
    coalesce(cte.equipment_snapshot, e.equipment_hint)
  from public.cycle_template_exercises cte
  join public.exercises e on e.id = cte.exercise_id
  where cte.template_id = v_template.id
  order by cte.sort_order;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'TEMPLATE_EMPTY';
  end if;

  select coalesce(max(version_no), 0) + 1
    into v_version
  from public.plan_versions
  where plan_id = v_plan_id;

  insert into public.plan_versions (
    plan_id, workout_number, version_no, source, status, snapshot
  ) values (
    v_plan_id,
    null,
    v_version,
    'cycle_template',
    'pending',
    jsonb_build_object(
      'version_role', 'initial',
      'plan', (select to_jsonb(p) from public.training_plans p where p.id = v_plan_id),
      'exercises', (
        select coalesce(jsonb_agg(to_jsonb(pe) order by pe.exercise_order), '[]'::jsonb)
        from public.training_plan_exercises pe
        where pe.plan_id = v_plan_id
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'replaced', v_replaced,
    'plan_id', v_plan_id,
    'cycle_code', v_template.code,
    'cycle_name', v_template.name,
    'expected_workout_number', v_expected
  );
end $$;


-- ------------------------------------------------------------
-- 2. 原子完成训练
-- ------------------------------------------------------------
create or replace function public.complete_workout(
  p_plan_id                 bigint,
  p_submission_key          text,
  p_workout_date            date,
  p_actual_duration_minutes integer,
  p_body_note               text,
  p_items                   jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_plan          public.training_plans%rowtype;
  v_existing      public.workouts%rowtype;
  v_pe            public.training_plan_exercises%rowtype;
  v_item          jsonb;

  v_number          integer;
  v_workout_id      bigint;
  v_version         integer;
  v_plan_version_id bigint;

  v_plan_count    integer;
  v_item_count    integer;
  v_distinct      integer;
  v_matched       integer;
  v_done          integer;
  v_total_rec     integer;
  v_percent       integer;

  v_completed     boolean;
  v_modified      boolean;
  v_difficulty    text;
  v_actual_weight numeric;
  v_actual_reps   text;
  v_actual_sets   integer;
  v_actual_dur    integer;
  v_actual_res_lb numeric;
  v_actual_res_kg numeric;
  v_source        text;
  v_note          text;
  v_done_sets     integer;
begin
  if p_submission_key is null or length(btrim(p_submission_key)) < 8 then
    raise exception 'INVALID_SUBMISSION_KEY';
  end if;

  if p_actual_duration_minutes is not null and p_actual_duration_minutes <= 0 then
    raise exception 'INVALID_DURATION';
  end if;

  -- 幂等：同一提交键已成功 → 直接返回原结果
  select * into v_existing
  from public.workouts
  where submission_key = p_submission_key
  limit 1;

  if found then
    if v_existing.training_plan_id is distinct from p_plan_id then
      raise exception 'SUBMISSION_KEY_REUSED';
    end if;

    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'workout_id', v_existing.id,
      'workout_number', v_existing.workout_number,
      'cycle_code', v_existing.cycle_code_snapshot,
      'cycle_name', v_existing.cycle_name_snapshot,
      'completion_percent', v_existing.completion_percent
    );
  end if;

  -- 锁定计划行：两个标签页并发时串行
  select * into v_plan
  from public.training_plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  if v_plan.status <> 'pending' then
    select * into v_existing
    from public.workouts
    where training_plan_id = p_plan_id
    limit 1;

    if found then
      if v_existing.submission_key = p_submission_key then
        return jsonb_build_object(
          'ok', true,
          'replayed', true,
          'workout_id', v_existing.id,
          'workout_number', v_existing.workout_number,
          'cycle_code', v_existing.cycle_code_snapshot,
          'cycle_name', v_existing.cycle_name_snapshot,
          'completion_percent', v_existing.completion_percent
        );
      end if;

      raise exception 'ALREADY_COMPLETED';
    end if;

    raise exception 'PLAN_NOT_PENDING';
  end if;

  -- 校验提交动作
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEM_COUNT_MISMATCH';
  end if;

  select count(*) into v_plan_count
  from public.training_plan_exercises
  where plan_id = p_plan_id;

  if v_plan_count = 0 then
    raise exception 'PLAN_EMPTY';
  end if;

  select jsonb_array_length(p_items) into v_item_count;

  select count(distinct x->>'plan_exercise_id')
    into v_distinct
  from jsonb_array_elements(p_items) x;

  select count(*)
    into v_matched
  from jsonb_array_elements(p_items) x
  join public.training_plan_exercises pe
    on pe.id = (x->>'plan_exercise_id')::bigint
   and pe.plan_id = p_plan_id;

  if v_item_count <> v_plan_count
     or v_distinct <> v_plan_count
     or v_matched <> v_plan_count then
    raise exception 'INVALID_PLAN_EXERCISE';
  end if;

  -- 事务内分配编号；失败会随事务回滚
  update public.workout_number_counter
  set last_number = last_number + 1,
      updated_at = now()
  where id = 1
  returning last_number into v_number;

  if v_number is null then
    raise exception 'COUNTER_NOT_INITIALIZED';
  end if;

  insert into public.workouts (
    workout_number, workout_date, title, focus,
    duration_minutes, actual_duration_minutes, completion_percent, body_note,
    training_plan_id, cycle_template_id,
    cycle_code_snapshot, cycle_name_snapshot, submission_key
  ) values (
    v_number,
    coalesce(p_workout_date, current_date),
    v_plan.title,
    v_plan.focus,
    v_plan.duration_minutes,
    p_actual_duration_minutes,
    0,
    p_body_note,
    p_plan_id,
    v_plan.cycle_template_id,
    v_plan.cycle_code_snapshot,
    v_plan.cycle_name_snapshot,
    p_submission_key
  )
  returning id into v_workout_id;

  -- 逐动作写快照 + 实际值
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_pe
    from public.training_plan_exercises
    where id = (v_item->>'plan_exercise_id')::bigint
      and plan_id = p_plan_id;

    if not found then
      raise exception 'INVALID_PLAN_EXERCISE';
    end if;

    v_completed := coalesce((v_item->>'completed')::boolean, true);
    v_modified  := coalesce((v_item->>'modified')::boolean, false);

    v_difficulty := nullif(btrim(coalesce(v_item->>'difficulty', '')), '');

    if v_difficulty is not null
       and v_difficulty not in ('easy','normal','hard','incomplete') then
      raise exception 'INVALID_DIFFICULTY';
    end if;

    if v_difficulty = 'incomplete' then
      v_completed := false;
    end if;

    if not v_completed then
      v_difficulty := 'incomplete';
      v_actual_weight := null;
      v_actual_reps   := null;
      v_actual_sets   := null;
      v_actual_dur    := null;
      v_actual_res_lb := null;
      v_actual_res_kg := null;
      v_source        := null;
    elsif v_modified then
      v_actual_weight := coalesce(
        nullif(v_item->>'actual_weight_kg', '')::numeric,
        v_pe.weight_kg
      );
      v_actual_reps := coalesce(
        nullif(v_item->>'actual_reps', ''),
        v_pe.reps
      );
      v_actual_sets := coalesce(
        nullif(v_item->>'actual_sets', '')::integer,
        v_pe.sets
      );
      v_actual_dur := coalesce(
        nullif(v_item->>'actual_duration_seconds', '')::integer,
        v_pe.duration_seconds
      );
      v_actual_res_lb := coalesce(
        nullif(v_item->>'actual_resistance_lb', '')::numeric,
        v_pe.resistance_lb
      );
      v_actual_res_kg := coalesce(
        nullif(v_item->>'actual_resistance_kg', '')::numeric,
        case v_actual_res_lb
          when 10 then 4.54
          when 15 then 6.80
          when 20 then 9.07
          else v_pe.resistance_kg
        end
      );
      v_source := 'user_confirmed';
    else
      v_actual_weight := v_pe.weight_kg;
      v_actual_reps   := v_pe.reps;
      v_actual_sets   := v_pe.sets;
      v_actual_dur    := v_pe.duration_seconds;
      v_actual_res_lb := v_pe.resistance_lb;
      v_actual_res_kg := v_pe.resistance_kg;
      v_source        := 'plan_default';
    end if;

    -- 阻力只允许 10 / 15 / 20 磅；绝不出现 45 磅。
    if v_actual_res_lb is not null
       and v_actual_res_lb not in (10, 15, 20) then
      raise exception 'INVALID_RESISTANCE';
    end if;

    if v_actual_sets is not null and v_actual_sets <= 0 then
      raise exception 'INVALID_ACTUAL_SETS';
    end if;

    if v_actual_dur is not null and v_actual_dur <= 0 then
      raise exception 'INVALID_ACTUAL_DURATION';
    end if;

    v_note := nullif(btrim(coalesce(v_item->>'note', '')), '');

    insert into public.workout_exercise_records (
      workout_id, workout_number, plan_exercise_id,
      exercise_id_snapshot, exercise_name_snapshot,
      equipment_snapshot, equipment_id_snapshot,
      resistance_lb_snapshot, resistance_kg_snapshot,
      phase_snapshot,
      planned_resistance_lb, planned_resistance_kg,
      planned_weight_kg, planned_reps, planned_sets,
      planned_duration_seconds, planned_rest_seconds,
      completed, difficulty,
      actual_weight_kg, actual_reps, actual_sets, actual_duration_seconds,
      actual_resistance_lb, actual_resistance_kg,
      actual_source, note, snapshot_source, snapshot_filled_at
    ) values (
      v_workout_id, v_number, v_pe.id,
      v_pe.exercise_id, v_pe.exercise_name,
      coalesce(v_pe.equipment_snapshot, v_pe.equipment), v_pe.equipment_id,
      v_pe.resistance_lb, v_pe.resistance_kg,
      coalesce(v_pe.phase, 'main'),
      v_pe.resistance_lb, v_pe.resistance_kg,
      v_pe.weight_kg, v_pe.reps, v_pe.sets,
      v_pe.duration_seconds, v_pe.rest_seconds,
      v_completed, v_difficulty,
      v_actual_weight, v_actual_reps, v_actual_sets, v_actual_dur,
      v_actual_res_lb, v_actual_res_kg,
      v_source, v_note, 'rpc', now()
    );
  end loop;

  -- 完成度
  select
    count(*) filter (where completed),
    count(*)
    into v_done, v_total_rec
  from public.workout_exercise_records
  where workout_id = v_workout_id;

  v_percent := case
    when v_total_rec = 0 then 0
    else round(100.0 * v_done / v_total_rec)::integer
  end;

  update public.workouts
  set completion_percent = v_percent
  where id = v_workout_id;

  -- 计划完成：写入真实编号
  update public.training_plans
  set status = 'completed',
      workout_number = v_number,
      updated_at = now()
  where id = p_plan_id;

  -- 应用版本快照
  select coalesce(max(version_no), 0) + 1
    into v_version
  from public.plan_versions
  where plan_id = p_plan_id;

  insert into public.plan_versions (
    plan_id, workout_number, version_no, source, status, snapshot
  ) values (
    p_plan_id,
    v_number,
    v_version,
    coalesce(v_plan.source, 'manual'),
    'applied',
    jsonb_build_object(
      'version_role', 'applied',
      'plan', (select to_jsonb(p) from public.training_plans p where p.id = p_plan_id),
      'exercises', (
        select coalesce(jsonb_agg(to_jsonb(pe) order by pe.exercise_order), '[]'::jsonb)
        from public.training_plan_exercises pe
        where pe.plan_id = p_plan_id
      )
    )
  )
  returning id into v_plan_version_id;

  update public.workouts
  set plan_version_id = v_plan_version_id
  where id = v_workout_id;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'workout_id', v_workout_id,
    'workout_number', v_number,
    'cycle_code', v_plan.cycle_code_snapshot,
    'cycle_name', v_plan.cycle_name_snapshot,
    'completion_percent', v_percent
  );
end $$;


-- ------------------------------------------------------------
-- 3. 原子替换当前 pending 计划内容（AI 导入 / 手动编辑）
--    - 仅允许 status='pending' 的计划
--    - 同一事务内：保存旧版本快照 → 更新计划 → 替换动作 → 写入新版本快照
--    - p_sync_template 必须显式为 true 才同步模板；默认 false
--    - 失败整体回滚，避免中途残缺
-- ------------------------------------------------------------
create or replace function public.apply_pending_plan_content(
  p_plan_id          bigint,
  p_title            text,
  p_focus            text,
  p_duration_minutes integer,
  p_notes            text,
  p_items            jsonb,
  p_source           text default 'ai',
  p_sync_template    boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_plan       public.training_plans%rowtype;
  v_item       jsonb;
  v_version    integer;
  v_source     text;
  v_count      integer := 0;
  v_order      integer;
  v_seen       integer[] := '{}';
  v_name       text;
  v_equip      text;
  v_weight     numeric;
  v_reps       text;
  v_sets       integer;
  v_note       text;
  v_phase      text;
  v_dur        integer;
  v_rest       integer;
  v_ex_id      bigint;
  v_eq_id      bigint;
  v_res_lb     numeric;
  v_res_kg     numeric;
  v_equip_snap text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ITEMS');
  end if;

  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'PLAN_EMPTY');
  end if;

  v_source := coalesce(nullif(btrim(p_source), ''), 'ai');

  if v_source not in ('cycle_template','ai','manual','legacy','import') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SOURCE');
  end if;

  select * into v_plan
  from public.training_plans
  where id = p_plan_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'PLAN_NOT_FOUND');
  end if;

  if v_plan.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'PLAN_NOT_PENDING');
  end if;

  if p_sync_template and v_plan.cycle_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'PLAN_HAS_NO_TEMPLATE');
  end if;

  -- 旧版本快照（导入/编辑前）
  -- plan_versions.status 只允许 pending/applied/archived；
  -- 替换前快照使用 archived，并通过 snapshot.version_role 标记用途。
  select coalesce(max(version_no), 0) + 1
    into v_version
  from public.plan_versions
  where plan_id = p_plan_id;

  insert into public.plan_versions (
    plan_id, workout_number, version_no, source, status, snapshot
  ) values (
    p_plan_id,
    null,
    v_version,
    v_source,
    'archived',
    jsonb_build_object(
      'version_role', 'pre_replace',
      'replaced_at', now(),
      'plan', to_jsonb(v_plan),
      'exercises', (
        select coalesce(jsonb_agg(to_jsonb(pe) order by pe.exercise_order), '[]'::jsonb)
        from public.training_plan_exercises pe
        where pe.plan_id = p_plan_id
      )
    )
  );

  update public.training_plans
  set title = coalesce(nullif(btrim(p_title), ''), v_plan.title),
      focus = coalesce(nullif(btrim(p_focus), ''), v_plan.focus),
      duration_minutes = coalesce(p_duration_minutes, v_plan.duration_minutes),
      notes = p_notes,
      source = v_source,
      updated_at = now()
  where id = p_plan_id;

  delete from public.training_plan_exercises
  where plan_id = p_plan_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;

    v_name := btrim(coalesce(v_item->>'exercise_name', ''));
    if v_name = '' then
      raise exception 'INVALID_EXERCISE_NAME';
    end if;

    v_order := coalesce(nullif(v_item->>'exercise_order', '')::integer, v_count);
    if v_order <= 0 then
      raise exception 'INVALID_EXERCISE_ORDER';
    end if;
    if v_order = any(v_seen) then
      raise exception 'DUPLICATE_EXERCISE_ORDER';
    end if;
    v_seen := array_append(v_seen, v_order);

    v_equip := coalesce(nullif(btrim(v_item->>'equipment'), ''), '自重');
    v_reps := coalesce(nullif(btrim(v_item->>'reps'), ''), '');
    if v_reps = '' then
      raise exception 'INVALID_REPS';
    end if;

    v_sets := coalesce(nullif(v_item->>'sets', '')::integer, 1);
    if v_sets <= 0 then
      raise exception 'INVALID_SETS';
    end if;

    v_weight := nullif(v_item->>'weight_kg', '')::numeric;
    if v_weight is not null and v_weight < 0 then
      raise exception 'INVALID_WEIGHT';
    end if;

    v_note := nullif(btrim(coalesce(v_item->>'notes', '')), '');

    v_phase := coalesce(nullif(btrim(v_item->>'phase'), ''), 'main');
    if v_phase not in ('warmup','main','cooldown') then
      raise exception 'INVALID_PHASE';
    end if;

    v_dur := nullif(v_item->>'duration_seconds', '')::integer;
    if v_dur is not null and v_dur <= 0 then
      raise exception 'INVALID_DURATION_SECONDS';
    end if;

    v_rest := nullif(v_item->>'rest_seconds', '')::integer;
    if v_rest is not null and v_rest < 0 then
      raise exception 'INVALID_REST_SECONDS';
    end if;

    -- 动作 ID：优先使用提供的 ID，否则按标准名 / 别名解析
    v_ex_id := nullif(v_item->>'exercise_id', '')::bigint;

    if v_ex_id is not null then
      if not exists (select 1 from public.exercises e where e.id = v_ex_id) then
        raise exception 'UNKNOWN_EXERCISE_ID';
      end if;
    else
      v_ex_id := public.v4_resolve_exercise_id(v_name);
      if v_ex_id is null then
        raise exception 'UNKNOWN_EXERCISE: %', v_name;
      end if;
    end if;

    -- 设备与阻力
    v_res_lb := nullif(v_item->>'resistance_lb', '')::numeric;

    if v_res_lb is null and v_equip like '%弹力%' then
      v_res_lb := coalesce(
        nullif(substring(v_equip from '([0-9]+(?:\.[0-9]+)?)\s*磅'), '')::numeric,
        15
      );
    end if;

    if v_res_lb is not null then
      if v_res_lb not in (10, 15, 20) then
        raise exception 'INVALID_RESISTANCE';
      end if;

      v_res_kg := coalesce(
        nullif(v_item->>'resistance_kg', '')::numeric,
        case v_res_lb
          when 10 then 4.54
          when 15 then 6.80
          when 20 then 9.07
        end
      );

      v_eq_id := nullif(v_item->>'equipment_id', '')::bigint;

      if v_eq_id is null then
        v_eq_id := public.v4_resolve_equipment_id(v_equip, v_res_lb);
      end if;

      if v_eq_id is null then
        raise exception 'UNKNOWN_EQUIPMENT';
      end if;

      if not exists (select 1 from public.user_equipment ue where ue.id = v_eq_id) then
        raise exception 'UNKNOWN_EQUIPMENT_ID';
      end if;

      v_equip_snap := coalesce(
        nullif(btrim(coalesce(v_item->>'equipment_snapshot', '')), ''),
        '弹力带 ' || v_res_lb::text || '磅'
      );
    else
      v_res_kg := null;
      v_eq_id := nullif(v_item->>'equipment_id', '')::bigint;

      if v_eq_id is not null
         and not exists (select 1 from public.user_equipment ue where ue.id = v_eq_id) then
        raise exception 'UNKNOWN_EQUIPMENT_ID';
      end if;

      v_equip_snap := coalesce(
        nullif(btrim(coalesce(v_item->>'equipment_snapshot', '')), ''),
        v_equip
      );
    end if;

    insert into public.training_plan_exercises (
      plan_id, exercise_order, exercise_name, equipment,
      weight_kg, reps, sets, notes,
      exercise_id, phase, duration_seconds, rest_seconds,
      equipment_id, resistance_lb, resistance_kg, equipment_snapshot
    ) values (
      p_plan_id, v_order, v_name, v_equip,
      v_weight, v_reps, v_sets, v_note,
      v_ex_id, v_phase, v_dur, v_rest,
      v_eq_id, v_res_lb, v_res_kg, v_equip_snap
    );
  end loop;

  if v_count = 0 then
    raise exception 'PLAN_EMPTY';
  end if;

  -- 显式同步模板：与 pending 替换同一事务，失败一起回滚。
  if p_sync_template then
    update public.cycle_templates
    set name = coalesce(nullif(btrim(p_title), ''), name),
        focus = coalesce(nullif(btrim(p_focus), ''), focus),
        duration_minutes = coalesce(p_duration_minutes, duration_minutes),
        notes = p_notes,
        updated_at = now()
    where id = v_plan.cycle_template_id;

    delete from public.cycle_template_exercises
    where template_id = v_plan.cycle_template_id;

    insert into public.cycle_template_exercises (
      template_id, exercise_id, sort_order, phase,
      reps, sets, weight_kg, duration_seconds, rest_seconds,
      equipment_id, resistance_lb, resistance_kg, equipment_snapshot, notes
    )
    select
      v_plan.cycle_template_id,
      pe.exercise_id,
      pe.exercise_order,
      coalesce(pe.phase, 'main'),
      pe.reps,
      pe.sets,
      pe.weight_kg,
      pe.duration_seconds,
      pe.rest_seconds,
      pe.equipment_id,
      pe.resistance_lb,
      pe.resistance_kg,
      pe.equipment_snapshot,
      pe.notes
    from public.training_plan_exercises pe
    where pe.plan_id = p_plan_id
    order by pe.exercise_order;
  end if;

  -- 新版本快照（替换后）
  select coalesce(max(version_no), 0) + 1
    into v_version
  from public.plan_versions
  where plan_id = p_plan_id;

  insert into public.plan_versions (
    plan_id, workout_number, version_no, source, status, snapshot
  ) values (
    p_plan_id,
    null,
    v_version,
    v_source,
    'pending',
    jsonb_build_object(
      'version_role', 'pending_after_replace',
      'plan', (select to_jsonb(p) from public.training_plans p where p.id = p_plan_id),
      'exercises', (
        select coalesce(jsonb_agg(to_jsonb(pe) order by pe.exercise_order), '[]'::jsonb)
        from public.training_plan_exercises pe
        where pe.plan_id = p_plan_id
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'plan_id', p_plan_id,
    'exercise_count', v_count,
    'template_synced', p_sync_template
  );
end $$;


-- ------------------------------------------------------------
-- 4. 原子保存循环模板
--    - 只改模板，不改 pending 计划、不改历史
--    - 删除旧模板动作后整体重建；失败整体回滚
-- ------------------------------------------------------------
create or replace function public.save_cycle_template(
  p_template_id      bigint,
  p_name             text,
  p_focus            text,
  p_duration_minutes integer,
  p_notes            text,
  p_items            jsonb,
  p_is_active        boolean default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_template public.cycle_templates%rowtype;
  v_item     jsonb;
  v_count    integer := 0;
  v_order    integer;
  v_seen     integer[] := '{}';
  v_name     text;
  v_equip    text;
  v_weight   numeric;
  v_reps     text;
  v_sets     integer;
  v_note     text;
  v_phase    text;
  v_dur      integer;
  v_rest     integer;
  v_ex_id    bigint;
  v_eq_id    bigint;
  v_res_lb   numeric;
  v_res_kg   numeric;
  v_equip_snap text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ITEMS');
  end if;

  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'TEMPLATE_EMPTY');
  end if;

  select * into v_template
  from public.cycle_templates
  where id = p_template_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'TEMPLATE_NOT_FOUND');
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TEMPLATE_NAME');
  end if;

  update public.cycle_templates
  set name = btrim(p_name),
      focus = p_focus,
      duration_minutes = coalesce(p_duration_minutes, duration_minutes),
      notes = p_notes,
      is_active = coalesce(p_is_active, is_active),
      updated_at = now()
  where id = p_template_id;

  delete from public.cycle_template_exercises
  where template_id = p_template_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;

    v_order := coalesce(nullif(v_item->>'exercise_order', '')::integer, v_count);
    if v_order <= 0 then
      raise exception 'INVALID_EXERCISE_ORDER';
    end if;
    if v_order = any(v_seen) then
      raise exception 'DUPLICATE_EXERCISE_ORDER';
    end if;
    v_seen := array_append(v_seen, v_order);

    v_name := btrim(coalesce(v_item->>'exercise_name', ''));
    if v_name = '' then
      raise exception 'INVALID_EXERCISE_NAME';
    end if;

    v_equip := coalesce(nullif(btrim(v_item->>'equipment'), ''), '自重');
    v_reps := coalesce(nullif(btrim(v_item->>'reps'), ''), '');
    if v_reps = '' then
      raise exception 'INVALID_REPS';
    end if;

    v_sets := coalesce(nullif(v_item->>'sets', '')::integer, 1);
    if v_sets <= 0 then
      raise exception 'INVALID_SETS';
    end if;

    v_weight := nullif(v_item->>'weight_kg', '')::numeric;
    if v_weight is not null and v_weight < 0 then
      raise exception 'INVALID_WEIGHT';
    end if;

    v_note := nullif(btrim(coalesce(v_item->>'notes', '')), '');

    v_phase := coalesce(nullif(btrim(v_item->>'phase'), ''), 'main');
    if v_phase not in ('warmup','main','cooldown') then
      raise exception 'INVALID_PHASE';
    end if;

    v_dur := nullif(v_item->>'duration_seconds', '')::integer;
    if v_dur is not null and v_dur <= 0 then
      raise exception 'INVALID_DURATION_SECONDS';
    end if;

    v_rest := nullif(v_item->>'rest_seconds', '')::integer;
    if v_rest is not null and v_rest < 0 then
      raise exception 'INVALID_REST_SECONDS';
    end if;

    v_ex_id := nullif(v_item->>'exercise_id', '')::bigint;
    if v_ex_id is not null then
      if not exists (select 1 from public.exercises e where e.id = v_ex_id) then
        raise exception 'UNKNOWN_EXERCISE_ID';
      end if;
    else
      v_ex_id := public.v4_resolve_exercise_id(v_name);
      if v_ex_id is null then
        raise exception 'UNKNOWN_EXERCISE: %', v_name;
      end if;
    end if;

    v_res_lb := nullif(v_item->>'resistance_lb', '')::numeric;

    if v_res_lb is null and v_equip like '%弹力%' then
      v_res_lb := coalesce(
        nullif(substring(v_equip from '([0-9]+(?:\.[0-9]+)?)\s*磅'), '')::numeric,
        15
      );
    end if;

    if v_res_lb is not null then
      if v_res_lb not in (10, 15, 20) then
        raise exception 'INVALID_RESISTANCE';
      end if;

      v_res_kg := coalesce(
        nullif(v_item->>'resistance_kg', '')::numeric,
        case v_res_lb
          when 10 then 4.54
          when 15 then 6.80
          when 20 then 9.07
        end
      );

      v_eq_id := nullif(v_item->>'equipment_id', '')::bigint;

      if v_eq_id is null then
        v_eq_id := public.v4_resolve_equipment_id(v_equip, v_res_lb);
      end if;

      if v_eq_id is null then
        raise exception 'UNKNOWN_EQUIPMENT';
      end if;

      if not exists (select 1 from public.user_equipment ue where ue.id = v_eq_id) then
        raise exception 'UNKNOWN_EQUIPMENT_ID';
      end if;

      v_equip_snap := coalesce(
        nullif(btrim(coalesce(v_item->>'equipment_snapshot', '')), ''),
        '弹力带 ' || v_res_lb::text || '磅'
      );
    else
      v_res_kg := null;
      v_eq_id := nullif(v_item->>'equipment_id', '')::bigint;

      if v_eq_id is not null
         and not exists (select 1 from public.user_equipment ue where ue.id = v_eq_id) then
        raise exception 'UNKNOWN_EQUIPMENT_ID';
      end if;

      v_equip_snap := coalesce(
        nullif(btrim(coalesce(v_item->>'equipment_snapshot', '')), ''),
        v_equip
      );
    end if;

    insert into public.cycle_template_exercises (
      template_id, exercise_id, sort_order, phase,
      reps, sets, weight_kg, duration_seconds, rest_seconds,
      equipment_id, resistance_lb, resistance_kg, equipment_snapshot, notes
    ) values (
      p_template_id, v_ex_id, v_order, v_phase,
      v_reps, v_sets, v_weight, v_dur, v_rest,
      v_eq_id, v_res_lb, v_res_kg, v_equip_snap, v_note
    );
  end loop;

  if v_count = 0 then
    raise exception 'TEMPLATE_EMPTY';
  end if;

  return jsonb_build_object(
    'ok', true,
    'template_id', p_template_id,
    'exercise_count', v_count
  );
end $$;


-- ------------------------------------------------------------
-- 5. 备份合并：计数器只升不降
-- ------------------------------------------------------------
create or replace function public.merge_workout_number_counter(
  p_last_number integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_last integer;
begin
  update public.workout_number_counter
  set last_number = greatest(
        last_number,
        coalesce(p_last_number, 0),
        (select coalesce(max(workout_number), 0) from public.workouts)
      ),
      updated_at = now()
  where id = 1
  returning last_number into v_last;

  if v_last is null then
    return jsonb_build_object('ok', false, 'error', 'COUNTER_NOT_INITIALIZED');
  end if;

  return jsonb_build_object('ok', true, 'last_number', v_last);
end $$;


-- ------------------------------------------------------------
-- 执行权限
--    当前项目无登录；anon 需要调用这些 RPC。
-- ------------------------------------------------------------
grant execute on function public.v4_resolve_exercise_id(text) to anon, authenticated;
grant execute on function public.v4_resolve_equipment_id(text, numeric) to anon, authenticated;
grant execute on function public.ensure_pending_plan(bigint, boolean) to anon, authenticated;
grant execute on function public.complete_workout(bigint, text, date, integer, text, jsonb) to anon, authenticated;
grant execute on function public.apply_pending_plan_content(bigint, text, text, integer, text, jsonb, text, boolean) to anon, authenticated;
grant execute on function public.save_cycle_template(bigint, text, text, integer, text, jsonb, boolean) to anon, authenticated;
grant execute on function public.merge_workout_number_counter(integer) to anon, authenticated;
