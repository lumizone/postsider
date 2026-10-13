/**
 * Routes whose JSON body may be far larger than Express' 100 KB default.
 * `/public/v1/upload-base64` carries a whole file as base64 (up to 25 MB
 * decoded, about 34 MB encoded), so without an entry here every real image is
 * rejected with 413 before the controller runs.
 */
export const LARGE_JSON_PATHS = ['/posts', '/public/v1/upload-base64'];
export const LARGE_JSON_LIMIT = '50mb';
