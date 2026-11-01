export type MailField = { label: string; value: string };
export type MailLine = { cells: string[] };

export type InwardMailTemplateParams = {
  companyName: string;
  companyCode?: string | null;
  legalName?: string | null;
  address?: string | null;
  companyEmail?: string | null;
  companyPhone?: string | null;
  taxNumber?: string | null;
  logoUrl?: string | null;
  title: string;
  intro: string;
  action: string;
  audience: string;
  fields: MailField[];
  lineTitle?: string;
  lineHeaders?: string[];
  lines?: MailLine[];
};

const FONT = 'Segoe UI,Helvetica,Arial,sans-serif';
const BRAND = '#0b6bff';
const INK = '#10233f';
const MUTED = '#5d6b7c';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fieldRows(fields: MailField[]): string {
  return fields
    .map((field, index) => {
      const bg = index % 2 === 0 ? '#f5f8fc' : '#ffffff';
      return `<tr>
        <td width="38%" valign="top" bgcolor="${bg}" style="width:38%;padding:10px 12px;background:${bg};border-bottom:1px solid #e4ebf3;font-family:${FONT};font-size:13px;line-height:1.4;color:${MUTED};font-weight:700;">${escapeHtml(field.label)}</td>
        <td valign="top" bgcolor="${bg}" style="padding:10px 12px;background:${bg};border-bottom:1px solid #e4ebf3;font-family:${FONT};font-size:14px;line-height:1.4;color:${INK};font-weight:600;">${escapeHtml(field.value || '—')}</td>
      </tr>`;
    })
    .join('');
}

function lineTable(title: string | undefined, headers: string[] | undefined, lines: MailLine[] | undefined): string {
  if (!headers?.length || !lines?.length) return '';
  const head = headers
    .map(
      (header) =>
        `<th align="left" style="padding:10px 12px;font-family:${FONT};font-size:12px;line-height:1.3;color:#ffffff;font-weight:700;">${escapeHtml(header)}</th>`,
    )
    .join('');
  const body = lines
    .map((line, index) => {
      const bg = index % 2 === 0 ? '#ffffff' : '#f5f8fc';
      const cells = headers
        .map((_, cellIndex) => {
          const value = line.cells[cellIndex] || '—';
          return `<td valign="top" bgcolor="${bg}" style="padding:10px 12px;background:${bg};border-bottom:1px solid #e4ebf3;font-family:${FONT};font-size:13px;line-height:1.4;color:${INK};">${escapeHtml(value)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `
          <tr>
            <td class="pad" style="padding:22px 32px 0 32px;font-family:${FONT};">
              <p style="margin:0 0 8px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND};font-weight:700;">${escapeHtml(title || 'Lines')}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #d7e1ec;border-radius:10px;overflow:hidden;">
                <tr bgcolor="${INK}">${head}</tr>
                ${body}
              </table>
            </td>
          </tr>`;
}

export function buildInwardMail(params: InwardMailTemplateParams): { text: string; html: string } {
  const companyName = params.companyName.trim() || 'Company';
  const legalName = params.legalName?.trim() || '';
  const address = params.address?.trim() || '';
  const logoUrl = params.logoUrl?.trim() || '';
  const fields = params.fields.filter((field) => field.value && field.value !== '—');
  const shown = fields.length ? fields : params.fields;

  const text = [
    companyName,
    legalName,
    address,
    [params.companyEmail, params.companyPhone, params.taxNumber ? `Tax ${params.taxNumber}` : ''].filter(Boolean).join(' | '),
    '',
    params.title,
    `For: ${params.audience}`,
    '',
    params.intro,
    '',
    ...shown.map((field) => `${field.label}: ${field.value}`),
    '',
    ...(params.lineHeaders?.length && params.lines?.length
      ? [
          params.lineTitle || 'Lines',
          params.lineHeaders.join(' | '),
          ...params.lines.map((line) => line.cells.join(' | ')),
          '',
        ]
      : []),
    `Action: ${params.action}`,
    '',
    companyName,
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const logoRow = logoUrl
    ? `<tr>
            <td class="pad" align="center" style="padding:28px 32px 8px 32px;">
              <img class="logo" src="${escapeHtml(logoUrl)}" width="220" alt="${escapeHtml(companyName)}" style="display:block;width:220px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>`
    : '';

  const identity = [params.companyCode, legalName].filter(Boolean).map((value) => escapeHtml(value || '')).join(' · ');
  const contact = [params.companyEmail, params.companyPhone, address, params.taxNumber ? `Tax ${params.taxNumber}` : '']
    .filter(Boolean)
    .map((value) => escapeHtml(value || ''))
    .join('<br/>');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.title)}</title>
  <style>
    body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0; mso-table-rspace: 0; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background: #e8eef6; }
    @media only screen and (max-width: 620px) {
      .shell { width: 100% !important; }
      .pad { padding-left: 16px !important; padding-right: 16px !important; }
      .logo { width: 180px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#e8eef6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(params.intro)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#e8eef6" style="background:#e8eef6;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" class="shell" width="640" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:640px;max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td bgcolor="${BRAND}" style="height:8px;background:${BRAND};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          ${logoRow}
          <tr>
            <td class="pad" align="center" style="padding:${logoUrl ? '8px' : '28px'} 32px 0 32px;font-family:${FONT};">
              <p style="margin:0;font-size:20px;line-height:1.3;color:${INK};font-weight:800;">${escapeHtml(companyName)}</p>
              ${identity ? `<p style="margin:6px 0 0 0;font-size:13px;line-height:1.4;color:${MUTED};">${identity}</p>` : ''}
              ${contact ? `<p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;color:${MUTED};">${contact}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:24px 32px 0 32px;font-family:${FONT};">
              <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND};font-weight:700;">Material Inward</p>
              <h1 style="margin:0;font-size:24px;line-height:1.3;color:${INK};font-weight:800;">${escapeHtml(params.title)}</h1>
              <p style="margin:12px 0 0 0;font-size:15px;line-height:1.6;color:#24344a;">${escapeHtml(params.intro)}</p>
              <p style="margin:8px 0 0 0;font-size:13px;line-height:1.5;color:${MUTED};">Sent to: ${escapeHtml(params.audience)}</p>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:18px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #d7e1ec;border-radius:10px;overflow:hidden;">
                ${fieldRows(shown)}
              </table>
            </td>
          </tr>
          ${lineTable(params.lineTitle, params.lineHeaders, params.lines)}
          <tr>
            <td class="pad" style="padding:22px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef5ff" style="width:100%;background:#eef5ff;border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.6;color:${INK};">
                    <strong>What to do</strong><br/>${escapeHtml(params.action)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:22px 32px 28px 32px;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">
              This message was sent by ${escapeHtml(companyName)} from the material inward workspace. Please do not reply to this mailbox unless your company uses it for purchasing correspondence.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { text, html };
}
