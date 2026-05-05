module.exports = {
  rootDir: "..",
  roots: ["<rootDir>/examples"],
  testEnvironment: "node",
  testMatch: ["<rootDir>/examples/**/*.test.js"],
  moduleNameMapper: {
    "^xapi$": "<rootDir>/dist/index.js",
  },
  modulePathIgnorePatterns: ["<rootDir>/examples/.*/node_modules"],
};
