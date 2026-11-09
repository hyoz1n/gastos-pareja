const { supabaseUrl, publishableKey } = window.APP_CONFIG;
const db = window.supabase.createClient(supabaseUrl, publishableKey);

const root = document.getElementById('app');
const toastEl = document.getElementById('toast');
const CATEGORIES = ['Alimentación', 'Hogar', 'Servicios', 'Transporte', 'Salud', 'Entretención', 'Compras', 'Mascotas', 'Otros'];
const VIEWS = [['inicio', 'Inicio'], ['gastos', 'Gastos'], ['resumen', 'Resumen'], ['ajustes', 'Ajustes']];
const state = { user: null, me: null, partner: null, household: null, view: 'inicio', month: currentMonth(), scope: '', draft: null, recovering: false };

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) el.append(child.nodeType ? child : String(child));
  }
  return el;
}

const field = (label, control) => h('label', { class: 'field' }, label, control);

function selectEl(options, value, props) {
  const el = h('select', props, options.map(([v, label]) => h('option', { value: v }, label)));
  el.value = value;
  return el;
}

const money = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fmt = (n) => money.format(n);
const fmtDate = (iso) => iso.split('-').reverse().join('/');

function santiagoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
}
function currentMonth() {
  return santiagoToday().slice(0, 7);
}
function monthRange(month) {
  const [year, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 10);
  return [`${month}-01`, next];
}

// Debe coincidir con el redondeo de get_balance en la base.
const otherPart = (e) => Math.round((e.amount * (100 - e.payer_share)) / 100);
function myPart(e) {
  if (e.scope === 'personal') return e.amount;
  return e.paid_by === state.user.id ? e.amount - otherPart(e) : otherPart(e);
}
const nameOf = (id) => (id === state.user.id ? 'Usted' : state.partner?.display_name ?? 'Su pareja');

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4500);
}

const AUTH_MESSAGES = [
  [/invalid login credentials/i, 'Correo o clave incorrectos.'],
  [/email not confirmed/i, 'Confirme su correo antes de ingresar.'],
  [/already registered/i, 'Ese correo ya tiene una cuenta. Ingrese con su clave.'],
  [/password should be|weak/i, 'Use una clave de al menos 8 caracteres, más difícil de adivinar.'],
  [/rate limit|too many/i, 'Demasiados intentos. Espere unos minutos.'],
  [/failed to fetch|network/i, 'Sin conexión. Revise internet e intente de nuevo.'],
];

function friendly(error) {
  if (error?.code === 'P0001') return error.message;
  const message = String(error?.message ?? '');
  return AUTH_MESSAGES.find(([re]) => re.test(message))?.[1] ?? 'No se pudo completar la operación. Intente de nuevo.';
}

const guard = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (error) {
    toast(friendly(error));
    return undefined;
  }
};

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function parseMoney(text) {
  const digits = String(text).replace(/[.\s$]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

function submitting(form, fn) {
  return guard(async (event) => {
    event.preventDefault();
    const button = form().querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await fn();
    } finally {
      button.disabled = false;
    }
  });
}

function renderAuth(mode = 'login') {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true });
  const password = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', minLength: 8, required: true });
  const siteUrl = location.origin + location.pathname;
  let form;
  const submit = submitting(() => form, async () => {
    if (mode === 'login') {
      const { error } = await db.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (error) throw error;
      return;
    }
    const { data, error } = await db.auth.signUp({ email: email.value.trim(), password: password.value, options: { emailRedirectTo: siteUrl } });
    if (error) throw error;
    if (!data.session) {
      root.replaceChildren(h('main', { class: 'auth' }, h('h1', {}, 'Revise su correo'), h('p', {}, 'Le enviamos un enlace para confirmar la cuenta. Después vuelva aquí e ingrese.'), h('button', { class: 'btn', onclick: () => renderAuth('login') }, 'Volver a ingresar')));
    }
  });
  form = h('form', { class: 'form', onsubmit: submit },
    field('Correo', email),
    field(mode === 'login' ? 'Clave' : 'Clave (mínimo 8 caracteres)', password),
    h('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? 'Ingresar' : 'Crear cuenta'));
  const forgot = guard(async () => {
    if (!email.value.trim()) { toast('Escriba su correo primero.'); return; }
    const { error } = await db.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: siteUrl });
    if (error) throw error;
    toast('Si el correo tiene cuenta, recibirá un enlace para cambiar la clave.');
  });
  root.replaceChildren(h('main', { class: 'auth' },
    h('h1', {}, 'Gastos en pareja'),
    h('p', { class: 'muted' }, 'Registren lo que gastan y sepan quién le debe a quién.'),
    form,
    mode === 'login' && h('button', { class: 'btn link', onclick: forgot }, 'Olvidé mi clave'),
    h('button', { class: 'btn link', onclick: () => renderAuth(mode === 'login' ? 'signup' : 'login') }, mode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo cuenta')));
}

function renderNewPassword() {
  const password = h('input', { type: 'password', autocomplete: 'new-password', minLength: 8, required: true });
  let form;
  form = h('form', {
    class: 'form',
    onsubmit: submitting(() => form, async () => {
      const { error } = await db.auth.updateUser({ password: password.value });
      if (error) throw error;
      state.recovering = false;
      toast('Clave actualizada.');
      await enter();
    }),
  }, field('Nueva clave', password), h('button', { class: 'btn primary', type: 'submit' }, 'Guardar clave'));
  root.replaceChildren(h('main', { class: 'auth' }, h('h1', {}, 'Cambie su clave'), form));
}

function renderOnboarding() {
  const name = h('input', { maxLength: 40, required: true, autocomplete: 'given-name' });
  const code = h('input', { maxLength: 12, required: true, autocapitalize: 'characters', autocomplete: 'off' });
  let joinForm;
  let createForm;
  createForm = h('form', {
    class: 'form',
    onsubmit: submitting(() => createForm, async () => {
      await run(db.rpc('create_household', { p_name: 'Nuestro hogar', p_display_name: name.value }));
      await enter();
    }),
  }, h('button', { class: 'btn primary', type: 'submit' }, 'Crear hogar e invitar a mi pareja'));
  joinForm = h('form', {
    class: 'form',
    onsubmit: submitting(() => joinForm, async () => {
      if (!name.value.trim()) { toast('Escriba su nombre.'); return; }
      await run(db.rpc('join_household', { p_code: code.value, p_display_name: name.value }));
      await enter();
    }),
  }, field('Código de invitación', code), h('button', { class: 'btn', type: 'submit' }, 'Unirme con este código'));
  const nameForm = h('div', { class: 'form' }, field('Su nombre', name));
  root.replaceChildren(h('main', { class: 'auth' },
    h('h1', {}, 'Su hogar'),
    nameForm,
    createForm,
    h('p', { class: 'muted' }, '¿Su pareja ya creó el hogar? Pídale el código.'),
    joinForm,
    h('button', { class: 'btn link', onclick: () => db.auth.signOut() }, 'Cerrar sesión')));
}

function scale(balance, reference) {
  const beam = h('div', { class: 'beam' }, h('span', { class: 'pan left' }), h('span', { class: 'pan right' }));
  const ratio = balance === 0 ? 0 : Math.min(1, Math.abs(balance) / Math.max(Math.abs(balance), reference || 1));
  const degrees = balance === 0 ? 0 : (3 + 7 * ratio) * (balance > 0 ? -1 : 1);
  requestAnimationFrame(() => requestAnimationFrame(() => { beam.style.transform = `rotate(${degrees}deg)`; }));
  const other = state.partner?.display_name ?? 'Su pareja';
  const verdict = balance === 0
    ? 'Están a mano'
    : balance > 0 ? `${other} le debe ${fmt(balance)}` : `Usted le debe ${fmt(-balance)} a ${other}`;
  return h('section', { class: 'scale', 'aria-label': 'Balance entre ambos' },
    h('div', { class: 'scale-stage', 'aria-hidden': 'true' }, beam, h('div', { class: 'fulcrum' })),
    h('div', { class: 'scale-names', 'aria-hidden': 'true' }, h('span', {}, 'Usted'), h('span', {}, other)),
    h('p', { class: 'verdict' }, verdict));
}

const expenseRow = (e) => h('button', { class: 'row', onclick: () => openForm(e) },
  h('span', { class: 'row-title' }, e.description, e.scope === 'personal' && h('span', { class: 'tag' }, 'Personal')),
  h('span', { class: 'amount' }, fmt(e.amount)),
  h('span', { class: 'muted' }, `${fmtDate(e.spent_on)} · ${e.category}${e.scope === 'comun' ? ` · pagó ${nameOf(e.paid_by)}` : ''}`),
  h('span', { class: 'muted amount' }, e.scope === 'comun' ? `su parte ${fmt(myPart(e))}` : ''));

function settleSection(balance, main) {
  if (balance === 0 || !state.partner) return null;
  const amount = h('input', { inputMode: 'numeric', value: String(Math.abs(balance)), required: true });
  const iPay = balance < 0;
  let form;
  form = h('form', {
    class: 'form',
    onsubmit: submitting(() => form, async () => {
      const value = parseMoney(amount.value);
      if (!value) { toast('Escriba el monto solo con números.'); return; }
      await run(db.from('settlements').insert({
        household_id: state.household.id,
        from_user: iPay ? state.user.id : state.partner.user_id,
        to_user: iPay ? state.partner.user_id : state.user.id,
        amount: value,
      }));
      toast('Pago registrado.');
      await viewInicio(main);
    }),
  }, field(iPay ? `Monto que le pagó a ${state.partner.display_name}` : `Monto que recibió de ${state.partner.display_name}`, amount),
  h('button', { class: 'btn', type: 'submit' }, 'Registrar pago'));
  return h('section', { class: 'group' }, h('h2', {}, 'Saldar cuentas'), form);
}

async function viewInicio(main) {
  const [start, end] = monthRange(currentMonth());
  const [balance, month, recent, payments] = await Promise.all([
    run(db.rpc('get_balance', { p_household: state.household.id })),
    run(db.from('expenses').select('amount, scope').eq('household_id', state.household.id).eq('scope', 'comun').gte('spent_on', start).lt('spent_on', end)),
    run(db.from('expenses').select('*').eq('household_id', state.household.id).order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(5)),
    run(db.from('settlements').select('*').eq('household_id', state.household.id).order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(5)),
  ]);
  const commonTotal = month.reduce((sum, e) => sum + e.amount, 0);
  main.replaceChildren(h('div', { class: 'stack' },
    !state.partner && h('section', { class: 'notice group' },
      h('h2', {}, 'Invite a su pareja'),
      h('p', {}, 'Pídale crear su cuenta e ingresar este código:'),
      h('p', { class: 'code' }, state.household.invite_code)),
    scale(balance, commonTotal),
    settleSection(balance, main),
    h('section', { class: 'group' },
      h('h2', {}, 'Últimos gastos'),
      recent.length === 0
        ? h('p', { class: 'muted' }, 'Registre el primer gasto con el botón Agregar gasto.')
        : h('div', { class: 'list' }, recent.map(expenseRow))),
    payments.length > 0 && h('section', { class: 'group' },
      h('h2', {}, 'Últimos pagos entre ustedes'),
      h('div', { class: 'list' }, payments.map((p) => h('div', { class: 'row plain' },
        h('span', {}, `${nameOf(p.from_user)} pagó a ${nameOf(p.to_user)}`, h('span', { class: 'muted' }, ` · ${fmtDate(p.paid_on)}`)),
        h('span', { class: 'actions' }, h('span', { class: 'amount' }, fmt(p.amount)), h('button', {
          class: 'btn link',
          onclick: guard(async () => {
            if (!window.confirm('¿Eliminar este pago? El balance volverá a incluirlo.')) return;
            await run(db.from('settlements').delete().eq('id', p.id));
            await viewInicio(main);
          }),
        }, 'Eliminar')))))),
  ));
}

async function viewGastos(main) {
  const [start, end] = monthRange(state.month);
  let query = db.from('expenses').select('*').eq('household_id', state.household.id).gte('spent_on', start).lt('spent_on', end)
    .order('spent_on', { ascending: false }).order('created_at', { ascending: false });
  if (state.scope) query = query.eq('scope', state.scope);
  const items = await run(query);
  const refresh = guard(() => viewGastos(main));
  main.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'filters' },
      field('Mes', h('input', { type: 'month', value: state.month, onchange: (e) => { if (e.target.value) { state.month = e.target.value; refresh(); } } })),
      field('Tipo', selectEl([['', 'Todos'], ['comun', 'Comunes'], ['personal', 'Personales']], state.scope, { onchange: (e) => { state.scope = e.target.value; refresh(); } }))),
    items.length === 0
      ? h('p', { class: 'muted' }, 'No hay gastos en este período.')
      : h('div', { class: 'list' }, items.map(expenseRow))));
}

async function viewResumen(main) {
  const [start, end] = monthRange(state.month);
  const items = await run(db.from('expenses').select('*').eq('household_id', state.household.id).gte('spent_on', start).lt('spent_on', end));
  const common = items.filter((e) => e.scope === 'comun');
  const commonTotal = common.reduce((s, e) => s + e.amount, 0);
  const myCommon = common.reduce((s, e) => s + myPart(e), 0);
  const personal = items.filter((e) => e.scope === 'personal').reduce((s, e) => s + e.amount, 0);
  const byCategory = new Map();
  for (const e of items) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + myPart(e));
  const rows = [...byCategory].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  main.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'filters' }, field('Mes', h('input', { type: 'month', value: state.month, onchange: guard(async (e) => { if (e.target.value) { state.month = e.target.value; await viewResumen(main); } }) }))),
    h('dl', { class: 'stats' },
      h('div', {}, h('dt', {}, 'Total común'), h('dd', {}, fmt(commonTotal))),
      h('div', {}, h('dt', {}, 'Su parte común'), h('dd', {}, fmt(myCommon))),
      h('div', {}, h('dt', {}, 'Sus personales'), h('dd', {}, fmt(personal)))),
    h('section', { class: 'group' },
      h('h2', {}, `Su gasto por categoría: ${fmt(myCommon + personal)}`),
      rows.length === 0 ? h('p', { class: 'muted' }, 'No hay gastos en este mes.') : h('div', { class: 'hbars' }, rows.map(([name, value]) => {
        const fill = h('span', { class: 'hbar-fill' });
        fill.style.width = `${(value / max) * 100}%`;
        return h('div', { class: 'hbar' }, h('span', { class: 'hbar-name' }, name), h('span', {}, fill), h('span', { class: 'amount' }, fmt(value)));
      })))));
}

async function viewAjustes(main) {
  const name = h('input', { value: state.me.display_name, maxLength: 40, required: true });
  let form;
  form = h('form', {
    class: 'form',
    onsubmit: submitting(() => form, async () => {
      await run(db.from('members').update({ display_name: name.value.trim() }).eq('user_id', state.user.id).eq('household_id', state.household.id));
      state.me.display_name = name.value.trim();
      toast('Nombre guardado.');
    }),
  }, field('Su nombre', name), h('button', { class: 'btn primary', type: 'submit' }, 'Guardar nombre'));
  main.replaceChildren(h('div', { class: 'stack' },
    h('section', { class: 'group' }, h('h2', {}, 'Su perfil'), h('p', { class: 'muted' }, state.user.email), form),
    h('section', { class: 'group' },
      h('h2', {}, 'Instalar en el celular'),
      h('p', { class: 'muted' }, 'En Android, abra el menú de Chrome y elija Instalar aplicación. En iPhone, en Safari toque Compartir y luego Agregar a inicio.')),
    h('button', { class: 'btn', onclick: guard(async () => { await db.auth.signOut(); }) }, 'Cerrar sesión')));
}

function openForm(expense) {
  state.draft = expense ?? {};
  go('form');
}

function viewForm(main) {
  const e = state.draft ?? {};
  const editing = Boolean(e.id);
  const amount = h('input', { inputMode: 'numeric', value: e.amount ? String(e.amount) : '', required: true, autofocus: !editing });
  const description = h('input', { value: e.description ?? '', maxLength: 100, required: true });
  const category = selectEl(CATEGORIES.map((c) => [c, c]), e.category ?? CATEGORIES[0], {});
  const date = h('input', { type: 'date', value: e.spent_on ?? santiagoToday(), required: true });
  const payers = [[state.user.id, 'Usted'], ...(state.partner ? [[state.partner.user_id, state.partner.display_name]] : [])];
  const payer = selectEl(payers, e.paid_by ?? state.user.id, {});
  const share = h('input', { type: 'number', min: 0, max: 100, step: 1, value: String(e.scope === 'comun' ? e.payer_share : 50), required: true });
  const scopeRadio = (value, label) => h('label', {}, h('input', { type: 'radio', name: 'scope', value, checked: (e.scope ?? 'comun') === value, onchange: sync }), label);
  const commonFields = h('div', { class: 'form' }, field('Quién pagó', payer), field('Porcentaje que le corresponde a quien pagó', share));
  const scopeValue = () => main.querySelector('input[name=scope]:checked')?.value ?? e.scope ?? 'comun';
  function sync() { commonFields.hidden = scopeValue() !== 'comun'; }

  let form;
  form = h('form', {
    class: 'form',
    onsubmit: submitting(() => form, async () => {
      const value = parseMoney(amount.value);
      if (!value) { toast('Escriba el monto solo con números.'); return; }
      const common = scopeValue() === 'comun';
      const shareValue = Number(share.value);
      if (common && !(Number.isInteger(shareValue) && shareValue >= 0 && shareValue <= 100)) { toast('El porcentaje debe estar entre 0 y 100.'); return; }
      const row = {
        amount: value,
        description: description.value.trim(),
        category: category.value,
        spent_on: date.value,
        scope: common ? 'comun' : 'personal',
        paid_by: common ? payer.value : (e.created_by ?? state.user.id),
        payer_share: common ? shareValue : 100,
      };
      if (editing) await run(db.from('expenses').update(row).eq('id', e.id));
      else await run(db.from('expenses').insert({ ...row, household_id: state.household.id, created_by: state.user.id }));
      toast(editing ? 'Gasto actualizado.' : 'Gasto guardado.');
      state.draft = null;
      await go(editing ? 'gastos' : 'inicio');
    }),
  },
  field('Monto', amount),
  field('Descripción', description),
  h('fieldset', { class: 'segmented' }, h('legend', { class: 'muted' }, 'Tipo de gasto'), scopeRadio('comun', 'Común'), (!editing || e.created_by === state.user.id) && scopeRadio('personal', 'Personal')),
  commonFields,
  field('Categoría', category),
  field('Fecha', date),
  h('div', { class: 'actions' },
    h('button', { class: 'btn primary', type: 'submit' }, editing ? 'Guardar cambios' : 'Guardar gasto'),
    h('button', { class: 'btn', type: 'button', onclick: () => { state.draft = null; go(editing ? 'gastos' : 'inicio'); } }, 'Cancelar'),
    editing && h('button', {
      class: 'btn',
      type: 'button',
      onclick: guard(async () => {
        if (!window.confirm(`¿Eliminar «${e.description}»? Esta acción no se puede deshacer.`)) return;
        await run(db.from('expenses').delete().eq('id', e.id));
        toast('Gasto eliminado.');
        state.draft = null;
        await go('gastos');
      }),
    }, 'Eliminar')));
  main.replaceChildren(h('section', { class: 'group' }, h('h2', {}, editing ? 'Editar gasto' : 'Nuevo gasto'), form));
  sync();
}

const RENDERERS = { inicio: viewInicio, gastos: viewGastos, resumen: viewResumen, ajustes: viewAjustes, form: viewForm };

const go = guard(async (view) => {
  state.view = view;
  const main = h('main', {});
  root.replaceChildren(h('div', { class: 'shell' },
    h('header', { class: 'top' }, h('h1', {}, 'Gastos en pareja')),
    main,
    view !== 'form' && h('button', { class: 'add', onclick: () => openForm() }, '+ Agregar gasto'),
    h('nav', { class: 'nav', 'aria-label': 'Secciones' }, VIEWS.map(([id, label]) => h('button', { onclick: () => go(id), 'aria-current': id === view ? 'page' : 'false' }, label)))));
  await RENDERERS[view](main);
  scrollTo(0, 0);
});

let entering = false;
const enter = guard(async () => {
  if (entering || state.recovering) return;
  entering = true;
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { state.user = null; renderAuth(); return; }
    state.user = session.user;
    const members = await run(db.from('members').select('*'));
    state.me = members.find((m) => m.user_id === state.user.id) ?? null;
    if (!state.me) { renderOnboarding(); return; }
    state.partner = members.find((m) => m.user_id !== state.user.id) ?? null;
    state.household = await run(db.from('households').select('*').eq('id', state.me.household_id).single());
    await go(state.draft ? 'form' : state.view);
  } finally {
    entering = false;
  }
});

// Supabase pide no llamar a su cliente dentro de este evento; por eso se difiere.
db.auth.onAuthStateChange((event) => {
  setTimeout(() => {
    if (event === 'PASSWORD_RECOVERY') { state.recovering = true; renderNewPassword(); return; }
    if (event === 'SIGNED_OUT') { Object.assign(state, { user: null, me: null, partner: null, household: null, view: 'inicio', draft: null }); renderAuth(); return; }
    if (event === 'SIGNED_IN' && !state.me) enter();
  }, 0);
});

// Al volver a la app se muestran los gastos que haya agregado la pareja.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me && state.view !== 'form') enter();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

enter();
