-- Preserve the weight behind named catalogue portions (for example, 1 slice = 100 g)
-- while allowing those custom portion units to convert to and from mass.
do $$
declare
  body text;
  old_text text;
  new_text text;
begin
  body := pg_catalog.pg_get_functiondef('private.convert_food_amount(numeric,text,text,numeric)'::regprocedure);
  old_text := $old$if from_dimension = 'serving' and to_dimension = 'mass' and p_grams_per_serving > 0 then$old$;
  new_text := $new$if from_dimension in ('serving','custom') and to_dimension = 'mass' and p_grams_per_serving > 0 then$new$;
  if pg_catalog.strpos(body,old_text) = 0 then raise exception 'Could not locate serving-to-basis conversion'; end if;
  body := pg_catalog.replace(body,old_text,new_text);
  execute body;
end $$;

do $$
declare
  body text;
  old_text text;
  new_text text;
  function_id regprocedure;
begin
  function_id := 'public.log_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb,uuid,integer)'::regprocedure;
  body := pg_catalog.pg_get_functiondef(function_id);
  old_text := 'component_amount := private.convert_food_amount(p_amount,p_unit,component_unit,null);';
  new_text := 'if p_manual_payload->''gramsPerServing'' is not null and p_manual_payload->''gramsPerServing''<>''null''::jsonb and (case when jsonb_typeof(p_manual_payload->''gramsPerServing'')=''number'' then (p_manual_payload->>''gramsPerServing'')::numeric<=0 or (p_manual_payload->>''gramsPerServing'')::numeric>=100000000 else true end) then raise exception using errcode=''22023'',message=''One-off portion weight is invalid''; end if;' || chr(10) || '    ' ||
    'component_amount := private.convert_food_amount(p_amount,p_unit,component_unit,nullif(p_manual_payload->>''gramsPerServing'','''')::numeric);';
  if pg_catalog.strpos(body,old_text) = 0 then raise exception 'Could not locate logged one-off portion conversion'; end if;
  body := pg_catalog.replace(body,old_text,new_text);
  old_text := '''basis_amount'',p_manual_payload->>''basisAmount'',''basis_unit'',component_unit,''grams_per_serving'',null,';
  new_text := '''basis_amount'',p_manual_payload->>''basisAmount'',''basis_unit'',component_unit,''grams_per_serving'',nullif(p_manual_payload->>''gramsPerServing'','''')::numeric,';
  if pg_catalog.strpos(body,old_text) = 0 then raise exception 'Could not locate logged portion snapshot field'; end if;
  body := pg_catalog.replace(body,old_text,new_text);
  execute body;

  function_id := 'public.calendar_log_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb,uuid,integer)'::regprocedure;
  body := pg_catalog.pg_get_functiondef(function_id);
  old_text := 'component_amount := private.convert_food_amount(p_amount,p_unit,component_unit,null);';
  new_text := 'if p_manual_payload->''gramsPerServing'' is not null and p_manual_payload->''gramsPerServing''<>''null''::jsonb and (case when jsonb_typeof(p_manual_payload->''gramsPerServing'')=''number'' then (p_manual_payload->>''gramsPerServing'')::numeric<=0 or (p_manual_payload->>''gramsPerServing'')::numeric>=100000000 else true end) then raise exception using errcode=''22023'',message=''One-off portion weight is invalid''; end if;' || chr(10) || '    ' ||
    'component_amount := private.convert_food_amount(p_amount,p_unit,component_unit,nullif(p_manual_payload->>''gramsPerServing'','''')::numeric);';
  if pg_catalog.strpos(body,old_text) = 0 then raise exception 'Could not locate calendar logged one-off portion conversion'; end if;
  body := pg_catalog.replace(body,old_text,new_text);
  old_text := '''basis_amount'',p_manual_payload->>''basisAmount'',''basis_unit'',component_unit,''grams_per_serving'',null,';
  new_text := '''basis_amount'',p_manual_payload->>''basisAmount'',''basis_unit'',component_unit,''grams_per_serving'',nullif(p_manual_payload->>''gramsPerServing'','''')::numeric,';
  if pg_catalog.strpos(body,old_text) = 0 then raise exception 'Could not locate calendar logged portion snapshot field'; end if;
  body := pg_catalog.replace(body,old_text,new_text);
  execute body;
end $$;

do $$
declare
  body text;
  old_text text;
  new_text text;
  function_id regprocedure;
begin
  function_id := 'public.plan_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb)'::regprocedure;
  body := pg_catalog.pg_get_functiondef(function_id);
  old_text := 'or private.convert_food_amount(p_amount,p_unit,component_food.basis_unit,null) is null then';
  new_text := 'or (p_manual_payload->''gramsPerServing'' is not null and p_manual_payload->''gramsPerServing''<>''null''::jsonb and case when jsonb_typeof(p_manual_payload->''gramsPerServing'')=''number'' then (p_manual_payload->>''gramsPerServing'')::numeric<=0 or (p_manual_payload->>''gramsPerServing'')::numeric>=100000000 else true end)' || chr(10) || '      ' ||
    'or private.convert_food_amount(p_amount,p_unit,component_food.basis_unit,nullif(p_manual_payload->>''gramsPerServing'','''')::numeric) is null then';
  if pg_catalog.strpos(body,old_text) = 0 then raise exception 'Could not locate planned one-off portion conversion'; end if;
  body := pg_catalog.replace(body,old_text,new_text);
  execute body;

  function_id := 'public.calendar_plan_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb)'::regprocedure;
  body := pg_catalog.pg_get_functiondef(function_id);
  if pg_catalog.strpos(body,old_text) = 0 then raise exception 'Could not locate calendar planned one-off portion conversion'; end if;
  body := pg_catalog.replace(body,old_text,new_text);
  execute body;
end $$;
