function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildVendorFormInviteEmail(params: {
  vendorName: string;
  formUrl: string;
  logoUrl: string;
  isReminder?: boolean;
}): { subject: string; text: string; html: string } {
  const vendorName = params.vendorName.trim() || 'Vendor';
  const subject = params.isReminder
    ? 'Reminder: Invitation to Complete Vendor Registration'
    : 'Invitation to Complete Vendor Registration';

  const text = [
    `Dear ${vendorName},`,
    '',
    'You have been invited by ANA Machinery Pvt Ltd to complete your vendor registration through the SWENTER ERP portal.',
    '',
    'Please use the link below to provide your company, contact, GST, bank, and other required information.',
    '',
    params.formUrl,
    '',
    'Please ensure that the information provided is accurate and up to date.',
    '',
    'This secure link expires 48 hours after it is sent. If you have already submitted the form, no further action is required.',
    '',
    'If you have any questions regarding the registration, please contact ANA Machinery Pvt Ltd — info@anamachinery.com / +91 96262 59191.',
    '',
    'Regards,',
    'ANA Machinery Pvt Ltd',
  ].join('\n');

  const safeName = escapeHtml(vendorName);
  const safeUrl = escapeHtml(params.formUrl);
  const safeLogo = escapeHtml(params.logoUrl);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#e8eef6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eef6;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
          <tr>
            <td style="height:8px;background:#0b6bff;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:36px 40px 8px 40px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
              <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#0b6bff;font-weight:700;">SWENTER ERP</p>
              <h1 style="margin:0;font-size:28px;line-height:1.25;color:#10233f;font-weight:800;">Invitation to Complete Vendor Registration</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 40px 0 40px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#24344a;font-size:16px;line-height:1.7;">
              <p style="margin:0 0 16px 0;">Dear <strong style="color:#10233f;">${safeName}</strong>,</p>
              <p style="margin:0 0 16px 0;">You have been invited by <strong style="color:#10233f;">ANA Machinery Pvt Ltd</strong> to complete your vendor registration through the SWENTER ERP portal.</p>
              <p style="margin:0;">Please use the link below to provide your company, contact, GST, bank, and other required information.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" bgcolor="#0b6bff" style="border-radius:10px;background:#0b6bff;">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;background:#0b6bff;border-radius:10px;text-decoration:none;">Complete Vendor Registration</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 0 40px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#5d6b7c;">
              This secure link expires 48 hours after it is sent. If you have already submitted the form, no further action is required.
            </td>
          </tr>
          <tr>
            <td style="padding:22px 40px 0 40px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#24344a;font-size:16px;line-height:1.7;">
              <p style="margin:0 0 16px 0;">Please ensure that the information provided is accurate and up to date.</p>
              <p style="margin:0;">If you have any questions regarding the registration, please contact <strong style="color:#10233f;">ANA Machinery Pvt Ltd</strong> — <a href="mailto:info@anamachinery.com" style="color:#0b6bff;font-weight:700;text-decoration:none;">info@anamachinery.com</a> / <a href="tel:+919626259191" style="color:#0b6bff;font-weight:700;text-decoration:none;">+91 96262 59191</a>.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 40px 8px 40px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#10233f;font-size:16px;line-height:1.6;">
              <p style="margin:0;">Regards,</p>
              <p style="margin:4px 0 0 0;font-weight:800;">ANA Machinery Pvt Ltd</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:12px 40px 36px 40px;">
              <img src="${safeLogo}" width="320" alt="ANA Machinery Pvt Ltd" style="display:block;width:320px;max-width:100%;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="height:6px;background:#e10600;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
