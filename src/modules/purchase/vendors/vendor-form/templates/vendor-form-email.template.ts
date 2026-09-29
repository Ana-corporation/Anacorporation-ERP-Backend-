import { VENDOR_FORM_TTL_HOURS } from '../vendor-form.constants';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type VendorFormInviteEmailParams = {
  vendorName: string;
  companyName: string;
  companyEmail?: string | null;
  companyPhone?: string | null;
  formUrl: string;
  /** Absolute URL; the logo row is omitted when missing. */
  logoUrl?: string | null;
  isReminder?: boolean;
};

const FONT = 'Segoe UI,Helvetica,Arial,sans-serif';
const BRAND_BLUE = '#0b6bff';
const BRAND_RED = '#e10600';

export function buildVendorFormInviteEmail(params: VendorFormInviteEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const vendorName = params.vendorName.trim() || 'Vendor';
  const companyName = params.companyName.trim() || 'SWENTER ERP';
  const companyEmail = params.companyEmail?.trim() || '';
  const companyPhone = params.companyPhone?.trim() || '';
  const logoUrl = params.logoUrl?.trim() || '';

  const title = 'Invitation to Complete Vendor Registration';
  const subject = `${params.isReminder ? 'Reminder: ' : ''}${title} — ${companyName}`;
  const expiryNote = `This secure link expires ${VENDOR_FORM_TTL_HOURS} hours after it is sent. If you have already submitted the form, no further action is required.`;
  const contactParts = [companyEmail, companyPhone].filter(Boolean);
  const contactText = contactParts.length
    ? `${companyName} — ${contactParts.join(' / ')}`
    : companyName;

  const text = [
    `Dear ${vendorName},`,
    '',
    `You have been invited by ${companyName} to complete your vendor registration through the SWENTER ERP portal.`,
    '',
    'Please use the link below to provide your company, contact, GST, bank, and other required information.',
    '',
    params.formUrl,
    '',
    'Please ensure that the information provided is accurate and up to date.',
    '',
    expiryNote,
    '',
    `If you have any questions regarding the registration, please contact ${contactText}.`,
    '',
    'Regards,',
    companyName,
  ].join('\n');

  const safeVendor = escapeHtml(vendorName);
  const safeCompany = escapeHtml(companyName);
  const safeUrl = escapeHtml(params.formUrl);

  const contactLinks = [
    companyEmail
      ? `<a href="mailto:${escapeHtml(companyEmail)}" style="color:${BRAND_BLUE};font-weight:700;text-decoration:none;">${escapeHtml(companyEmail)}</a>`
      : '',
    companyPhone
      ? `<a href="tel:${escapeHtml(companyPhone.replace(/[^\d+]/g, ''))}" style="color:${BRAND_BLUE};font-weight:700;text-decoration:none;">${escapeHtml(companyPhone)}</a>`
      : '',
  ].filter(Boolean);
  const contactHtml = contactLinks.length
    ? `<strong style="color:#10233f;">${safeCompany}</strong> — ${contactLinks.join(' / ')}`
    : `<strong style="color:#10233f;">${safeCompany}</strong>`;

  const logoRow = logoUrl
    ? `
          <tr>
            <td class="pad" align="center" style="padding:12px 40px 36px 40px;">
              <img class="logo" src="${escapeHtml(logoUrl)}" width="320" alt="${safeCompany}" style="display:block;width:320px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>`
    : `
          <tr>
            <td style="padding:0 0 28px 0;font-size:0;line-height:0;">&nbsp;</td>
          </tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(subject)}</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0; mso-table-rspace: 0; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background: #e8eef6; }
    @media only screen and (max-width: 620px) {
      .shell { width: 100% !important; }
      .pad { padding-left: 22px !important; padding-right: 22px !important; }
      .logo { width: 240px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#e8eef6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${safeCompany} invited you to complete vendor registration in SWENTER ERP.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#e8eef6" style="background:#e8eef6;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
          <tr>
            <td bgcolor="${BRAND_BLUE}" style="height:8px;background:${BRAND_BLUE};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td class="pad" style="padding:36px 40px 8px 40px;font-family:${FONT};">
              <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND_BLUE};font-weight:700;">SWENTER ERP</p>
              <h1 style="margin:0;font-size:28px;line-height:1.25;color:#10233f;font-weight:800;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:22px 40px 0 40px;font-family:${FONT};color:#24344a;font-size:16px;line-height:1.7;">
              <p style="margin:0 0 16px 0;">Dear <strong style="color:#10233f;">${safeVendor}</strong>,</p>
              <p style="margin:0 0 16px 0;">You have been invited by <strong style="color:#10233f;">${safeCompany}</strong> to complete your vendor registration through the SWENTER ERP portal.</p>
              <p style="margin:0;">Please use the link below to provide your company, contact, GST, bank, and other required information.</p>
            </td>
          </tr>
          <tr>
            <td class="pad" align="center" style="padding:28px 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" bgcolor="${BRAND_BLUE}" style="padding:14px 28px;border-radius:10px;background:${BRAND_BLUE};">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;">Complete Vendor Registration</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:12px 40px 0 40px;font-family:${FONT};font-size:13px;line-height:1.6;color:#5d6b7c;">
              <p style="margin:0 0 8px 0;">If the button does not work, copy and paste this link into your browser:</p>
              <p style="margin:0 0 12px 0;word-break:break-all;"><a href="${safeUrl}" target="_blank" style="color:${BRAND_BLUE};text-decoration:underline;">${safeUrl}</a></p>
              <p style="margin:0;">${escapeHtml(expiryNote)}</p>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:22px 40px 0 40px;font-family:${FONT};color:#24344a;font-size:16px;line-height:1.7;">
              <p style="margin:0 0 16px 0;">Please ensure that the information provided is accurate and up to date.</p>
              <p style="margin:0;">If you have any questions regarding the registration, please contact ${contactHtml}.</p>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:28px 40px 8px 40px;font-family:${FONT};color:#10233f;font-size:16px;line-height:1.6;">
              <p style="margin:0;">Regards,</p>
              <p style="margin:4px 0 0 0;font-weight:800;">${safeCompany}</p>
            </td>
          </tr>${logoRow}
          <tr>
            <td bgcolor="${BRAND_RED}" style="height:6px;background:${BRAND_RED};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
