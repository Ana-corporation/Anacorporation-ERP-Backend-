import { buildVendorFormInviteEmail } from './vendor-form-email.template';

const base = {
  vendorName: 'MRK Engineering',
  companyName: 'Acme Manufacturing',
  companyEmail: 'purchase@acme.com',
  companyPhone: '+65 1234 5678',
  formUrl: 'https://swenter.com/vendor-form/abc',
  logoUrl: 'https://cdn.example.com/acme.png',
};

describe('buildVendorFormInviteEmail', () => {
  it('uses the inviting company details instead of hard-coded ANA values', () => {
    const { subject, text, html } = buildVendorFormInviteEmail(base);

    expect(subject).toBe('Invitation to Complete Vendor Registration — Acme Manufacturing');
    for (const body of [text, html]) {
      expect(body).not.toMatch(/ANA Machinery|anamachinery|96262/i);
      expect(body).toContain('Acme Manufacturing');
      expect(body).toContain('purchase@acme.com');
    }
    expect(html).toContain('mailto:purchase@acme.com');
    expect(html).toContain('tel:+6512345678');
    expect(html).toContain('src="https://cdn.example.com/acme.png"');
    expect(html).toContain('SWENTER ERP');
  });

  it('adds a plain copy link and Outlook-safe colours and button padding', () => {
    const { html } = buildVendorFormInviteEmail(base);

    expect(html).toContain('If the button does not work, copy and paste this link into your browser:');
    expect(html).toContain('bgcolor="#0b6bff"');
    expect(html).toContain('bgcolor="#e10600"');
    expect(html).not.toContain('linear-gradient');
    expect(html).toMatch(/<td align="center" bgcolor="#0b6bff" style="padding:14px 28px;/);
    expect(html).not.toMatch(/<a [^>]*style="[^"]*padding/);
    expect(html).not.toMatch(/<table[^>]*style="[^"]*padding/);
  });

  it('omits missing contact details and logo, and falls back to "Vendor"', () => {
    const { text, html } = buildVendorFormInviteEmail({
      ...base,
      vendorName: '',
      companyEmail: null,
      companyPhone: null,
      logoUrl: null,
    });

    expect(text).toContain('Dear Vendor,');
    expect(text).toContain('please contact Acme Manufacturing.');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('mailto:');
  });

  it('prefixes reminder subjects and escapes HTML in names', () => {
    const { subject, html } = buildVendorFormInviteEmail({
      ...base,
      vendorName: '<b>Evil</b>',
      isReminder: true,
    });

    expect(subject.startsWith('Reminder: ')).toBe(true);
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
  });
});
