import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";

describe("React Router integration", () => {
  it("renders MemoryRouter and routes in React 18 environment", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Link to="/apps">Go to Apps</Link>} />
          <Route path="/apps" element={<div>Apps Gallery</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Go to Apps")).toBeInTheDocument();
  });
});
