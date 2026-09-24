import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../src/components/StatusBadge";
import { fetchMeta } from "../src/services/metaService";

describe("StatusBadge", () => {
  it("renders public status with check icon", () => {
    render(<StatusBadge status="공개" isPublic={true} />);
    expect(screen.getByText("공개")).toBeInTheDocument();
    expect(screen.getByTestId("status-check-icon")).toBeInTheDocument();
  });

  it("renders private status with lock icon", () => {
    render(<StatusBadge status="비공개" isPublic={false} />);
    expect(screen.getByText("비공개")).toBeInTheDocument();
    expect(screen.getByTestId("status-lock-icon")).toBeInTheDocument();
  });

  it("validates metaService contract mock", async () => {
    const meta = await fetchMeta();
    expect(meta.subjects).toContain("수학");
    expect(meta.capabilities.healthCheck).toBe(true);
  });
});
