class AppError extends Error {
  // `code` is an optional machine-readable tag for the few refusals a
  // client has to react to structurally rather than just display. Matching
  // on the message text instead would break the moment the wording changes
  // or gets translated. Left undefined for the vast majority of errors,
  // where showing the message is the whole job.
  constructor(statusCode, message, code) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = AppError;
