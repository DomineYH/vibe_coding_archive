import { expect, it, vi } from "vitest";
import {
  captureAuthInvalidation,
  subscribeAuthInvalidation,
} from "../src/services/auth-invalidation";
import { ServiceError } from "../src/services/service-error";

it("captures the requesting observation and ignores late callbacks after unsubscribe", () => {
  let observation = 1;
  const receive = vi.fn();
  const unsubscribe = subscribeAuthInvalidation(() => {
    const captured = observation;
    return (error) => {
      if (captured === observation) receive(error);
    };
  });
  const old = captureAuthInvalidation();
  observation = 2;
  old(new ServiceError("AUTH_REQUIRED", "lost"));
  expect(receive).not.toHaveBeenCalled();
  const current = captureAuthInvalidation();
  for (const code of [
    "FORBIDDEN",
    "INVALID_CREDENTIALS",
    "CSRF_INVALID",
    "NETWORK_ERROR",
  ] as const)
    current(new ServiceError(code, "ordinary"));
  expect(receive).not.toHaveBeenCalled();
  current(new ServiceError("AUTH_STATE_CHANGED", "lost"));
  expect(receive).toHaveBeenCalledTimes(1);
  unsubscribe();
  current(new ServiceError("AUTH_REQUIRED", "late"));
  expect(receive).toHaveBeenCalledTimes(1);
});
