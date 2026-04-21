import mockXapi from "./xapi.ts";
import { jest } from "@jest/globals";

jest.mock("xapi", () => ({
  __esModule: true,
  default: mockXapi,
}), { virtual: true });

export default mockXapi;