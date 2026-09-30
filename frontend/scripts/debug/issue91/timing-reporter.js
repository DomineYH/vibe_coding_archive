import fs from "node:fs";
import path from "node:path";
export default class {
  onTestBegin(test) {
    this.started = performance.now();
    this.screenshots = 0;
    this.emit({
      event: "begin",
      title: test.title,
      repeat: test.repeatEachIndex,
    });
  }
  onStepEnd(test, result, step) {
    if (
      step.category !== "pw:api" ||
      !/Screenshot|Navigate|Reload|Evaluate/.test(step.title)
    )
      return;
    this.emit({
      event: "step",
      repeat: test.repeatEachIndex,
      api: step.title.split(" ")[0],
      capture: /Screenshot/.test(step.title) ? ++this.screenshots : null,
      line: step.location?.line,
      ms: step.duration,
      elapsedMs: performance.now() - this.started,
      failed: Boolean(step.error),
    });
  }
  onTestEnd(test, result) {
    this.emit({
      event: "end",
      title: test.title,
      repeat: test.repeatEachIndex,
      status: result.status,
      ms: result.duration,
      signature: result.errors.some((error) =>
        /page.screenshot: Test timeout of 60000ms exceeded/.test(
          error.message || "",
        ),
      )
        ? "screenshot-60s"
        : result.errors.some((error) =>
              /strict mode violation/.test(error.message || ""),
            )
          ? "strict-status"
          : null,
    });
  }
  emit(row) {
    const dir = path.resolve("test-results/issue91-diagnosis");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, `${process.env.EVIDENCE_RUN}.jsonl`),
      JSON.stringify(row) + "\n",
    );
  }
}
