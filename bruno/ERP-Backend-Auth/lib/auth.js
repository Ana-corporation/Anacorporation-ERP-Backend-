/**
 * Shared helpers for ERP Backend Bruno collection.
 * Used by post-response scripts to save tokens automatically.
 */

function getData(res) {
  const body = res.getBody();
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body).data ?? null;
    } catch {
      return null;
    }
  }
  return body.data ?? null;
}

function saveCompanyAuth(res) {
  const data = getData(res);
  if (!data) return;

  if (data.accessToken) {
    bru.setEnvVar('accessToken', data.accessToken);
    console.log('Saved accessToken');
  }
  if (data.activeCompany?.companyId) {
    bru.setEnvVar('companyId', String(data.activeCompany.companyId));
    bru.setEnvVar('switchCompanyId', String(data.activeCompany.companyId));
  }
  if (data.activeCompany?.companyCode) {
    bru.setEnvVar('companyCode', data.activeCompany.companyCode);
  }
  if (data.user?.userId) {
    bru.setEnvVar('userId', String(data.user.userId));
  }
}

function saveSuperAdminAuth(res) {
  const data = getData(res);
  if (!data) return;

  if (data.accessToken) {
    bru.setEnvVar('superAdminAccessToken', data.accessToken);
    console.log('Saved superAdminAccessToken');
  }
  if (data.user?.superAdminId) {
    bru.setEnvVar('superAdminId', String(data.user.superAdminId));
  }
}

function saveResolveCompany(res) {
  const data = getData(res);
  if (!data) return;

  if (data.companyId) {
    bru.setEnvVar('companyId', String(data.companyId));
    bru.setEnvVar('switchCompanyId', String(data.companyId));
  }
  if (data.companyCode) {
    bru.setEnvVar('companyCode', data.companyCode);
  }
}

function clearCompanyAuth() {
  bru.setEnvVar('accessToken', '');
  bru.setEnvVar('userId', '');
}

function clearSuperAdminAuth() {
  bru.setEnvVar('superAdminAccessToken', '');
  bru.setEnvVar('superAdminId', '');
}

function assertSuccess(res) {
  const status = res.getStatus();
  if (status < 200 || status >= 300) {
    throw new Error(`Expected 2xx but got ${status}: ${JSON.stringify(res.getBody())}`);
  }

  const body = res.getBody();
  const parsed = typeof body === 'string' ? JSON.parse(body) : body;
  if (parsed && parsed.success === false) {
    throw new Error(`API returned success=false: ${JSON.stringify(parsed)}`);
  }
}

module.exports = {
  saveCompanyAuth,
  saveSuperAdminAuth,
  saveResolveCompany,
  clearCompanyAuth,
  clearSuperAdminAuth,
  assertSuccess,
  getData,
};
