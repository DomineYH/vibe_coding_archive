import { describe, expect, it } from "vitest";
import { mapBatchAccepted, mapHealthBatch } from "../src/contracts/mappers";

const batchId = "00000000-0000-4000-8000-000000000301";
const time = "2026-09-22T00:12:00.000Z";

function batch(patch: Record<string, unknown> = {}) {
  return {
    id: batchId,
    created_at: time,
    finished_at: null,
    is_finished: false,
    server_time: time,
    target_count: 3,
    processed_count: 1,
    counts: {
      queued: 1,
      running: 1,
      result_obtained: 1,
      failed: 0,
      cancelled: 0,
      reused: 1,
    },
    ...patch,
  };
}

describe("health batch response mappers", () => {
  it("maps fixed target and processed counts with reuse as a subset", () => {
    expect(
      mapBatchAccepted({ disposition: "created", batch: batch() }, 202),
    ).toEqual({
      disposition: "created",
      batch: {
        id: batchId,
        createdAt: time,
        finishedAt: null,
        isFinished: false,
        serverTime: time,
        targetCount: 3,
        processedCount: 1,
        counts: {
          queued: 1,
          running: 1,
          resultObtained: 1,
          failed: 0,
          cancelled: 0,
          reused: 1,
        },
      },
    });
  });

  it("accepts an immediately finished empty batch with HTTP 202", () => {
    expect(
      mapBatchAccepted(
        {
          disposition: "created",
          batch: batch({
            finished_at: time,
            is_finished: true,
            target_count: 0,
            processed_count: 0,
            counts: {
              queued: 0,
              running: 0,
              result_obtained: 0,
              failed: 0,
              cancelled: 0,
              reused: 0,
            },
          }),
        },
        202,
      ),
    ).toMatchObject({ batch: { isFinished: true, targetCount: 0 } });
  });

  it.each([
    {
      target_count: 4,
    },
    {
      processed_count: 2,
    },
    {
      counts: {
        queued: 1,
        running: 1,
        result_obtained: 1,
        failed: 0,
        cancelled: 0,
        reused: 2,
      },
    },
    { is_finished: true },
  ])("rejects a broken batch count invariant: %o", (patch) => {
    expect(() => mapHealthBatch(batch(patch))).toThrowError(
      expect.objectContaining({ code: "CONTRACT_ERROR" }),
    );
  });
});
