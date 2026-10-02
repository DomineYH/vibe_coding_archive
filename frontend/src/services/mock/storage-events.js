import { getMockSnapshot } from "./state";

function nonHealthState(state) {
  const copy = { ...state };
  for (const key of [
    "generation",
    "scenario",
    "health_measurements",
    "health_batches",
    "health_id_sequence",
  ])
    delete copy[key];
  for (const key of ["apps", "private_apps"])
    copy[key] = state[key]
      .map((app) => {
        const copy = { ...app };
        delete copy.health;
        return copy;
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(copy);
}

export function isMockHealthStorageUpdate(oldValue, newValue) {
  if (oldValue === null || newValue === null || oldValue === newValue)
    return false;
  try {
    const previous = JSON.parse(oldValue);
    const next = JSON.parse(newValue);
    // Damaged storage and auth scenarios still require concealment and proof.
    const current = getMockSnapshot();
    if (
      previous.version !== current.version ||
      next.version !== current.version ||
      typeof previous.scenario !== "string" ||
      typeof next.scenario !== "string" ||
      previous.scenario.startsWith("auth_") ||
      next.scenario.startsWith("auth_") ||
      (previous.scenario !== next.scenario &&
        !next.scenario.startsWith("health_"))
    )
      return false;
    // Compare every other field, including authority and unknown future fields.
    return nonHealthState(previous) === nonHealthState(next);
  } catch {
    return false;
  }
}
