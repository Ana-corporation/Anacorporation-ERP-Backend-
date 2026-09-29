import { detectVendorFormAttachmentMime } from './vendor-form-attachments.util';

describe('detectVendorFormAttachmentMime', () => {
  const zip = (entry: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(entry)]);
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);

  it.each([
    ['GST.pdf', Buffer.from('%PDF-1.4'), 'application/pdf'],
    ['pan.PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), 'image/png'],
    ['cheque.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['msme.webp', Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 '), 'image/webp'],
    ['letter.docx', zip('word/document.xml'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['rates.xlsx', zip('xl/workbook.xml'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['old.doc', ole, 'application/msword'],
    ['old.xls', ole, 'application/vnd.ms-excel'],
    ['list.csv', Buffer.from('name,gstin\nAcme,33AAAAA0000A1Z5\n'), 'text/csv'],
  ])('accepts %s', (name, buffer, mime) => {
    expect(detectVendorFormAttachmentMime(name, buffer)).toBe(mime);
  });

  it.each([
    ['renamed.pdf', Buffer.from('MZ\x90\x00')],
    ['sheet.docx', zip('xl/workbook.xml')],
    ['binary.csv', Buffer.from([0x41, 0x00, 0x42])],
    ['script.exe', Buffer.from('%PDF-1.4')],
    ['pdf', Buffer.from('%PDF-1.4')],
  ])('rejects %s', (name, buffer) => {
    expect(detectVendorFormAttachmentMime(name, buffer)).toBeNull();
  });
});
