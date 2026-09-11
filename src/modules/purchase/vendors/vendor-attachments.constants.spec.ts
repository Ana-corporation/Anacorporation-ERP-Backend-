import {
  resolveVendorAttachmentMime,
  withVendorAttachmentAliases,
} from './vendor-attachments.constants';

describe('vendor-attachments.constants', () => {
  it('accepts the same types as item attachments', () => {
    expect(resolveVendorAttachmentMime('quote.pdf', 'application/pdf')).toBe('application/pdf');
    expect(resolveVendorAttachmentMime('sheet.xlsx', '')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(resolveVendorAttachmentMime('photo.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(resolveVendorAttachmentMime('note.svg', 'image/svg+xml')).toBeNull();
  });

  it('echoes metadata.attachments as attachments and attachmentsJson', () => {
    const result = withVendorAttachmentAliases({
      vendorId: '1',
      metadata: {
        website: 'https://abc.com',
        attachments: [{ fileName: 'quote.pdf', fileAssetId: 'abc' }],
      },
    });

    expect(result.attachments).toEqual([{ fileName: 'quote.pdf', fileAssetId: 'abc' }]);
    expect(result.attachmentsJson).toEqual(result.attachments);
    expect((result.metadata as { attachments: unknown[] }).attachments).toEqual(
      result.attachments,
    );
  });
});
