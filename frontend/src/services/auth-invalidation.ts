import { ServiceError } from "./service-error";

type Notify = (error: unknown) => void;
type Capture = () => Notify;
let subscriber: Capture | undefined;

export function subscribeAuthInvalidation(capture: Capture) {
  subscriber = capture;
  return () => {
    if (subscriber === capture) subscriber = undefined;
  };
}

export function captureAuthInvalidation(): Notify {
  const owner = subscriber;
  const notify = owner?.();
  return (error) => {
    if (
      subscriber === owner &&
      error instanceof ServiceError &&
      [
        "AUTH_REQUIRED",
        "RECOVERY_REQUIRED",
        "AUTH_STATE_CHANGED",
        "AUTH_TRANSITION_PENDING",
      ].includes(error.code)
    )
      notify?.(error);
  };
}
