export function buildVendorFormInviteEmail(params: {
  vendorName: string;
  formUrl: string;
  isReminder?: boolean;
}): { subject: string; text: string; html: string } {
  const subject = params.isReminder
    ? `Reminder: Complete your vendor information — ${params.vendorName}`
    : `Vendor Form Request — ${params.vendorName}`;

  const text = [
    'Vendor Form Request',
    '',
    'Please complete the vendor information using the link below.',
    '',
    params.formUrl,
    '',
    'This link will expire after 48 hours.',
    '',
    'If you have already submitted the form, no further action is required.',
  ].join('\n');

  const html = `
    <p><strong>Vendor Form Request</strong></p>
    <p>Please complete the vendor information using the link below.</p>
    <p><a href="${params.formUrl}">Complete Vendor Form</a></p>
    <p>This link will expire after 48 hours.</p>
    <p>If you have already submitted the form, no further action is required.</p>
  `.trim();

  return { subject, text, html };
}
