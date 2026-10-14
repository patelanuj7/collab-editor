export type OTErrorCode =
  | 'INVALID_OPERATION'
  | 'LENGTH_MISMATCH'
  | 'INVALID_REVISION'
  | 'STALE_REVISION'
  | 'DOC_TOO_LARGE';

/** Thrown by the OT core. `code` lets callers decide how to recover (e.g. force a resync). */
export class OTError extends Error {
  code: OTErrorCode;

  constructor(code: OTErrorCode, message: string) {
    super(message);
    this.name = 'OTError';
    this.code = code;
  }
}
