/**
 * Populate DEMO_ACME so Platform Owner company-detail tabs have matching entries:
 * Overview, Subscription, Modules & Entitlements, Company Admins, Users & Access, Activity & Audit.
 *
 * Usage (BE running on :3002):
 *   node scripts/populate-demo-acme-platform-tabs.js
 */
const API = process.env.API_URL || 'http://localhost:3002/api/v1';

async function req(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message || json?.error || res.statusText;
    throw new Error(`${method} ${path} → ${res.status} ${msg}`);
  }
  return json.data ?? json;
}

function todayPlusYears(n) {
  const d = new Date();
  const start = d.toISOString().slice(0, 10);
  d.setFullYear(d.getFullYear() + n);
  return { start, end: d.toISOString().slice(0, 10) };
}

async function main() {
  console.log('Login PLATFORM / OWNER001 …');
  const login = await req('POST', '/auth/login', null, {
    companyCode: 'PLATFORM',
    employeeCode: 'OWNER001',
    password: 'Owner@123',
  });
  const token = login.accessToken;
  console.log('permissions sample:', (login.permissions || []).slice(0, 12).join(', '));

  const companies = await req('GET', '/companies?search=DEMO_ACME&limit=5', token);
  const demo = (companies.items || companies || []).find((c) => c.companyCode === 'DEMO_ACME');
  if (!demo) throw new Error('DEMO_ACME not found');
  const companyId = demo.companyId;
  console.log(`DEMO_ACME companyId=${companyId} status=${demo.status}`);

  // Overview enrichment + status lifecycle (creates audit)
  console.log('Set status trial → active (audit) …');
  await req('PATCH', `/companies/${companyId}/status`, token, { status: 'trial' });
  await req('PATCH', `/companies/${companyId}/status`, token, { status: 'active' });

  // Subscription
  const plansPage = await req('GET', '/subscription/plans?limit=50', token).catch(() =>
    req('GET', '/plans?limit=50', token),
  );
  const plans = plansPage.items || plansPage || [];
  let plan =
    plans.find((p) => p.planCode === 'DEMO_STARTER') ||
    plans.find((p) => String(p.planCode || '').toUpperCase().includes('STARTER')) ||
    plans.find((p) => p.isActive !== false) ||
    plans[0];
  if (!plan) throw new Error('No subscription plan found');
  console.log(`Assign plan ${plan.planCode} (${plan.planId}) …`);
  const { start, end } = todayPlusYears(1);
  try {
    await req('POST', `/companies/${companyId}/subscriptions`, token, {
      planId: String(plan.planId),
      startDate: start,
      endDate: end,
      billingCycle: 'monthly',
      amount: 0,
      autoRenew: true,
      status: 'active',
    });
  } catch (e) {
    console.log('  subscription create note:', e.message);
  }

  // Modules entitlements — create from product catalogue if missing
  let modsPage = await req('GET', `/companies/${companyId}/modules?limit=50`, token);
  let mods = Array.isArray(modsPage) ? modsPage : modsPage.items || [];
  if (mods.length === 0) {
    const catalog = await req(
      'GET',
      '/subscription/modules/grantable',
      token,
    );
    const productMods = Array.isArray(catalog) ? catalog : catalog.items || catalog || [];
    console.log(`Creating ${productMods.length} grantable company module entitlements …`);
    for (const m of productMods) {
      try {
        await req('POST', `/companies/${companyId}/modules`, token, {
          moduleId: String(m.moduleId),
          isActive: true,
        });
        console.log(`  + ${m.moduleCode}`);
      } catch (e) {
        console.log(`  ${m.moduleCode}:`, e.message);
      }
    }
    modsPage = await req('GET', `/companies/${companyId}/modules?limit=50`, token);
    mods = Array.isArray(modsPage) ? modsPage : modsPage.items || [];
  }
  console.log(`Company modules: ${mods.length}`);
  for (const m of mods.slice(0, 8)) {
    const moduleId = m.moduleId || m.companyModuleId;
    if (!moduleId) continue;
    try {
      await req('PATCH', `/companies/${companyId}/modules/${m.companyModuleId || moduleId}`, token, {
        isActive: true,
      });
      console.log(`  enabled ${m.moduleCode || moduleId}`);
    } catch (e) {
      console.log(`  module ${moduleId}:`, e.message);
    }
  }

  // Admins + users (list for confirmation)
  const admins = await req('GET', `/companies/${companyId}/admins`, token).catch(() =>
    req('GET', `/companies/${companyId}/users?roleCode=ADMIN&limit=50`, token),
  );
  const adminItems = Array.isArray(admins) ? admins : admins.items || [];
  console.log(`Company Admins: ${adminItems.length}`);
  adminItems.forEach((u) =>
    console.log(`  - ${u.email} (${u.role?.roleCode || 'ADMIN'})`),
  );

  const users = await req('GET', `/companies/${companyId}/users?limit=100`, token);
  const userItems = Array.isArray(users) ? users : users.items || [];
  console.log(`Users & Access: ${userItems.length} users`);

  // Detail + audit
  const detail = await req('GET', `/companies/${companyId}`, token);
  console.log('Overview fields:', {
    status: detail.status,
    planCode: detail.planCode,
    planName: detail.planName,
    subscriptionStatus: detail.subscriptionStatus,
    userCount: detail.userCount,
    userLimit: detail.userLimit,
    primaryAdminEmail: detail.primaryAdminEmail,
    activeModuleCount: detail.activeModuleCount,
  });

  const audit = await req('GET', `/companies/${companyId}/audit-logs?limit=20`, token);
  const auditItems = audit.items || [];
  console.log(`Activity & Audit: ${auditItems.length} events (total=${audit.total ?? auditItems.length})`);
  auditItems.slice(0, 8).forEach((a) =>
    console.log(`  - ${a.occurredAt} ${a.action} :: ${a.details}`),
  );

  console.log('\nDone. Logout/login as PLATFORM / OWNER001 and open DEMO_ACME.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
