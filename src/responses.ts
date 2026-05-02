export const commandSuccessResponse = { status: "OK" };

export const invalidCommandError = {
  code: 3,
  message: "Unknown command",
};

export const invalidPathError = {
  code: 3,
  message: "No match on address expression",
};

export const missingOrInvalidCommandParametersError = {
  code: 4,
  message: "Invalid or missing parameters",
};
