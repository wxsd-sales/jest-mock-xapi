
import xapi from './xapi.ts';
import { jest } from "@jest/globals";


jest.mock('xapi', () => {
  return {
    __esModule: true,
    default: xapi
  };
}, { virtual: true });
