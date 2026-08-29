import {
  CSV_IMPORT_FIELD_VALUE_MAX_BYTES,
  CSV_UPLOAD_MAX_FILE_BYTES,
  UPLOAD_FIELD_NAME_MAX_BYTES,
  UPLOAD_FIELD_VALUE_MAX_BYTES,
  UPLOAD_MAX_FIELD_COUNT,
  UPLOAD_MAX_FILE_BYTES,
  UPLOAD_MAX_FILE_MB,
  uploadInterceptorOptions,
  csvImportInterceptorOptions,
} from './upload.limits';

describe('uploadInterceptorOptions', () => {
  it('shares one byte ceiling with non-multipart upload paths', () => {
    expect(UPLOAD_MAX_FILE_BYTES).toBe(UPLOAD_MAX_FILE_MB * 1024 * 1024);
    expect(uploadInterceptorOptions.limits.fileSize).toBe(
      UPLOAD_MAX_FILE_BYTES
    );
    expect(uploadInterceptorOptions.limits).toMatchObject({
      files: 1,
      fields: UPLOAD_MAX_FIELD_COUNT,
      parts: UPLOAD_MAX_FIELD_COUNT + 1,
      fieldNameSize: UPLOAD_FIELD_NAME_MAX_BYTES,
      fieldSize: UPLOAD_FIELD_VALUE_MAX_BYTES,
    });
    expect(UPLOAD_FIELD_VALUE_MAX_BYTES).toBe(64 * 1024);
  });
});

describe('csvImportInterceptorOptions', () => {
  it('enforces the 2 MB CSV limit while Multer reads the request', () => {
    expect(CSV_UPLOAD_MAX_FILE_BYTES).toBe(2 * 1024 * 1024);
    expect(csvImportInterceptorOptions.limits.fileSize).toBe(
      CSV_UPLOAD_MAX_FILE_BYTES
    );
    expect(csvImportInterceptorOptions.limits).toMatchObject({
      files: 1,
      fields: 1,
      parts: 2,
      fieldNameSize: 16,
      fieldSize: CSV_IMPORT_FIELD_VALUE_MAX_BYTES,
    });
    expect(CSV_IMPORT_FIELD_VALUE_MAX_BYTES).toBe('false'.length);
  });
});
