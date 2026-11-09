-- Prueba de permisos con usuarios ficticios. Ejecutar en el SQL Editor de Supabase.
-- Termina siempre con un error llamado RESULTADOS, que revierte todo: no deja datos.
-- Cada línea debe mostrar el valor esperado o comenzar con «ok». «FALLA» indica un problema.
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_h uuid; v_code text; v_common uuid; v_personal uuid; v_n bigint; v_r text[] := '{}';
begin
  insert into auth.users (id, email) values (v_a,'a@prueba.invalid'),(v_b,'b@prueba.invalid'),(v_c,'c@prueba.invalid');
  perform set_config('role','authenticated',true);

  perform set_config('request.jwt.claims', json_build_object('sub',v_a,'role','authenticated')::text, true);
  v_h := public.create_household('H','Ana');
  select invite_code into v_code from public.households where id=v_h;
  v_r := v_r || ('codigo_visible_A='||(v_code is not null));
  insert into public.expenses (household_id,created_by,paid_by,scope,amount,description,category,payer_share)
    values (v_h,v_a,v_a,'comun',10000,'comun A','Hogar',50) returning id into v_common;
  insert into public.expenses (household_id,created_by,paid_by,scope,amount,description,category,payer_share)
    values (v_h,v_a,v_a,'personal',5000,'secreto A','Otros',100) returning id into v_personal;
  begin perform public.create_household('H2','Ana'); v_r:=v_r||'FALLA segundo_hogar'::text; exception when others then v_r:=v_r||('ok segundo_hogar '||sqlstate); end;

  perform set_config('request.jwt.claims', json_build_object('sub',v_b,'role','authenticated')::text, true);
  perform public.join_household(v_code,'Bea');
  select count(*) into v_n from public.expenses; v_r:=v_r||('B_ve_gastos(esperado 1)='||v_n);
  select count(*) into v_n from public.expenses where description='secreto A'; v_r:=v_r||('B_ve_secreto(esperado 0)='||v_n);
  select public.get_balance(v_h) into v_n; v_r:=v_r||('saldo_B(esperado -5000)='||v_n);
  update public.expenses set amount=1 where id=v_personal; get diagnostics v_n=row_count; v_r:=v_r||('B_edita_personal_A(esperado 0)='||v_n);
  delete from public.expenses where id=v_personal; get diagnostics v_n=row_count; v_r:=v_r||('B_borra_personal_A(esperado 0)='||v_n);
  begin update public.expenses set created_by=v_b where id=v_common; v_r:=v_r||'FALLA cambia_created_by'::text; exception when others then v_r:=v_r||('ok cambia_created_by '||sqlstate); end;
  begin update public.expenses set scope='personal',payer_share=100 where id=v_common; v_r:=v_r||'FALLA oculta_comun_ajeno'::text; exception when others then v_r:=v_r||('ok oculta_comun_ajeno '||sqlstate); end;
  begin insert into public.expenses (household_id,created_by,paid_by,scope,amount,description,category) values (v_h,v_a,v_a,'comun',1,'x','Otros'); v_r:=v_r||'FALLA suplanta_A'::text; exception when others then v_r:=v_r||('ok suplanta_A '||sqlstate); end;
  begin insert into public.expenses (household_id,created_by,paid_by,scope,amount,description,category,payer_share) values (v_h,v_b,v_a,'personal',1,'x','Otros',100); v_r:=v_r||'FALLA personal_pagado_otro'::text; exception when others then v_r:=v_r||('ok personal_pagado_otro '||sqlstate); end;
  insert into public.expenses (household_id,created_by,paid_by,scope,amount,description,category,payer_share) values (v_h,v_b,v_b,'comun',3000,'comun B','Hogar',50);
  select public.get_balance(v_h) into v_n; v_r:=v_r||('saldo_B(esperado -3500)='||v_n);
  insert into public.settlements (household_id,from_user,to_user,amount,created_by) values (v_h,v_b,v_a,3500,v_b);
  select public.get_balance(v_h) into v_n; v_r:=v_r||('saldo_B_tras_pago(esperado 0)='||v_n);

  perform set_config('request.jwt.claims', json_build_object('sub',v_a,'role','authenticated')::text, true);
  select public.get_balance(v_h) into v_n; v_r:=v_r||('saldo_A_tras_pago(esperado 0)='||v_n);
  select count(*) into v_n from public.expenses; v_r:=v_r||('A_ve_gastos(esperado 3)='||v_n);

  perform set_config('request.jwt.claims', json_build_object('sub',v_c,'role','authenticated')::text, true);
  begin perform public.join_household(v_code,'Intruso'); v_r:=v_r||'FALLA tercer_miembro'::text; exception when others then v_r:=v_r||('ok tercer_miembro '||sqlstate); end;
  select count(*) into v_n from public.expenses; v_r:=v_r||('C_ve_gastos(esperado 0)='||v_n);
  select count(*) into v_n from public.members; v_r:=v_r||('C_ve_miembros(esperado 0)='||v_n);
  select count(*) into v_n from public.households; v_r:=v_r||('C_ve_hogares(esperado 0)='||v_n);
  select count(*) into v_n from public.settlements; v_r:=v_r||('C_ve_pagos(esperado 0)='||v_n);
  select public.get_balance(v_h) into v_n; v_r:=v_r||('saldo_C(esperado 0)='||v_n);
  begin insert into public.expenses (household_id,created_by,paid_by,scope,amount,description,category) values (v_h,v_c,v_c,'comun',1,'x','Otros'); v_r:=v_r||'FALLA C_inserta'::text; exception when others then v_r:=v_r||('ok C_inserta '||sqlstate); end;
  begin insert into public.members (household_id,user_id,display_name) values (v_h,v_c,'x'); v_r:=v_r||'FALLA C_se_agrega'::text; exception when others then v_r:=v_r||('ok C_se_agrega '||sqlstate); end;
  begin update public.households set invite_code='X'; v_r:=v_r||'FALLA C_cambia_codigo'::text; exception when others then v_r:=v_r||('ok C_cambia_codigo '||sqlstate); end;

  perform set_config('role','anon',true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin select count(*) into v_n from public.expenses; v_r:=v_r||('FALLA anon_lee '||v_n); exception when others then v_r:=v_r||('ok anon_lee '||sqlstate); end;
  begin perform public.get_balance(v_h); v_r:=v_r||'FALLA anon_rpc'::text; exception when others then v_r:=v_r||('ok anon_rpc '||sqlstate); end;

  raise exception E'RESULTADOS:\n%', array_to_string(v_r, E'\n');
end $$;
